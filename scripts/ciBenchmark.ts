import { performance } from 'node:perf_hooks';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { priceCache } from '../src/oracles/priceCache.js';
import { SlippageGuard } from '../src/execution/slippageGuard.js';
import { PgaFallbackBroadcaster } from '../src/execution/pgaFallback.js';
import type { ObligationState } from '../src/types/index.js';

interface LatencyStats {
  samples: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  throughputOpsSec: number;
}

function calculateStats(latencies: number[], totalDurationMs: number): LatencyStats {
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const p95Idx = Math.floor(sorted.length * 0.95);
  const p99Idx = Math.floor(sorted.length * 0.99);

  return {
    samples: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    avgMs: sum / sorted.length,
    p95Ms: sorted[p95Idx],
    p99Ms: sorted[p99Idx],
    throughputOpsSec: (sorted.length / (totalDurationMs / 1000)),
  };
}

async function runHealthFactorBenchmark(iterations: number = 2000): Promise<LatencyStats> {
  const sampleObligation: ObligationState = {
    protocol: 'navi',
    obligationId: '0x1111111111111111111111111111111111111111111111111111111111111111',
    ownerAddress: '0x2222222222222222222222222222222222222222222222222222222222222222',
    collaterals: [
      { coinType: '0x2::sui::SUI', symbol: 'SUI', amount: 1_000_000_000n, decimals: 9, valueUsd: 2.5, liquidationThreshold: 0.8 },
    ],
    debts: [
      { coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', symbol: 'USDC', amount: 3_000_000n, decimals: 6, valueUsd: 3.0 },
    ],
    totalCollateralUsd: 2.5,
    totalDebtUsd: 3.0,
    healthFactor: 0.6667,
    isLiquidatable: true,
    lastUpdateTimestamp: Date.now(),
  };

  // priceCache already has seeded default prices for SUI ($0.80) and USDC ($1.00)

  const latencies: number[] = [];
  const startAll = performance.now();

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    HealthFactorEngine.findBestLiquidationOpportunity(sampleObligation, 0.35);
    const t1 = performance.now();
    latencies.push(t1 - t0);
  }

  const endAll = performance.now();
  return calculateStats(latencies, endAll - startAll);
}

async function runSlippageBenchmark(iterations: number = 2000): Promise<LatencyStats> {
  const latencies: number[] = [];
  const startAll = performance.now();

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    SlippageGuard.validateSlippage(10_000_000n, 9_950_000n, 100);
    SlippageGuard.validatePriceDivergence(2.50, 2.51, 100);
    const t1 = performance.now();
    latencies.push(t1 - t0);
  }

  const endAll = performance.now();
  return calculateStats(latencies, endAll - startAll);
}

async function runPgaCalculationBenchmark(iterations: number = 2000): Promise<LatencyStats> {
  const broadcaster = new PgaFallbackBroadcaster();
  const latencies: number[] = [];
  const startAll = performance.now();

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    broadcaster.calculatePriorityGasPrice(1000n, 15.5, 2.5, (i % 3) + 1, 0.15);
    const t1 = performance.now();
    latencies.push(t1 - t0);
  }

  const endAll = performance.now();
  return calculateStats(latencies, endAll - startAll);
}

async function main(): Promise<void> {
  console.log('⚡ Running Automated CI Performance Benchmarks & Threshold Verification...\n');

  const hfStats = await runHealthFactorBenchmark(2000);
  console.log('📊 HealthFactor Engine & Valuation:');
  console.log(`   Samples: ${hfStats.samples}`);
  console.log(`   Avg: ${hfStats.avgMs.toFixed(4)} ms | P95: ${hfStats.p95Ms.toFixed(4)} ms | P99: ${hfStats.p99Ms.toFixed(4)} ms`);
  console.log(`   Throughput: ${hfStats.throughputOpsSec.toFixed(0)} ops/sec\n`);

  const slipStats = await runSlippageBenchmark(2000);
  console.log('📊 Slippage Guard Math & Boundary Checks:');
  console.log(`   Samples: ${slipStats.samples}`);
  console.log(`   Avg: ${slipStats.avgMs.toFixed(4)} ms | P95: ${slipStats.p95Ms.toFixed(4)} ms | P99: ${slipStats.p99Ms.toFixed(4)} ms`);
  console.log(`   Throughput: ${slipStats.throughputOpsSec.toFixed(0)} ops/sec\n`);

  const pgaStats = await runPgaCalculationBenchmark(2000);
  console.log('📊 PGA Gas Stepping & Pricing Computation:');
  console.log(`   Samples: ${pgaStats.samples}`);
  console.log(`   Avg: ${pgaStats.avgMs.toFixed(4)} ms | P95: ${pgaStats.p95Ms.toFixed(4)} ms | P99: ${pgaStats.p99Ms.toFixed(4)} ms`);
  console.log(`   Throughput: ${pgaStats.throughputOpsSec.toFixed(0)} ops/sec\n`);

  // CI Performance Thresholds
  const MAX_HF_P95_MS = 1.0; // 1 ms threshold for valuation
  const MIN_THROUGHPUT_OPS = 5000; // minimum 5k valuations/sec

  let failed = false;
  if (hfStats.p95Ms > MAX_HF_P95_MS) {
    console.error(`❌ HealthFactor P95 latency (${hfStats.p95Ms.toFixed(4)} ms) exceeded threshold (${MAX_HF_P95_MS} ms)`);
    failed = true;
  }
  if (hfStats.throughputOpsSec < MIN_THROUGHPUT_OPS) {
    console.error(`❌ Valuation throughput (${hfStats.throughputOpsSec.toFixed(0)} ops/s) fell below threshold (${MIN_THROUGHPUT_OPS} ops/s)`);
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }

  console.log('✅ ALL PERFORMANCE THRESHOLDS MET! CI Benchmark Verification: PASSED');
}

main().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
