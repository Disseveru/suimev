import { describe, it, expect, beforeAll } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { CetusRouter } from '../src/protocols/dex/cetusRouter.js';
import { DeepBookRouter } from '../src/protocols/dex/deepbookRouter.js';
import { priceCache } from '../src/oracles/priceCache.js';

describe('DEX Routers (Cetus CLMM & DeepBook v3)', () => {
  const SUI_TYPE = '0x2::sui::SUI';
  const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

  beforeAll(() => {
    priceCache.updatePrice({
      symbol: 'SUI',
      coinType: SUI_TYPE,
      price: 2.50,
      confidence: 0,
      exponent: -8,
      rawPrice: 250000000n,
      publishTime: 1700000000,
      lastUpdatedMs: Date.now(),
    });

    priceCache.updatePrice({
      symbol: 'USDC',
      coinType: USDC_TYPE,
      price: 1.00,
      confidence: 0,
      exponent: -8,
      rawPrice: 100000000n,
      publishTime: 1700000000,
      lastUpdatedMs: Date.now(),
    });
  });

  it('should compute accurate Cetus CLMM quote with 1% slippage deduction', () => {
    // 100 SUI ($250) into USDC ($1.00)
    // Expected output: 250 USDC (250_000_000 units with 6 decimals)
    // With 1% (100 bps) slippage: 250 * 0.99 = 247.5 USDC (247_500_000 units)
    const amountIn = 100_000_000_000n; // 100 SUI (9 decimals)
    const quote = CetusRouter.getQuote(SUI_TYPE, USDC_TYPE, amountIn, 100);

    expect(quote.dex).toBe('cetus');
    expect(quote.amountIn).toBe(amountIn);
    expect(quote.expectedAmountOut).toBe(250_000_000n);
    expect(quote.minimumAmountOut).toBe(247_500_000n);
    expect(quote.slippageBps).toBe(100);
    expect(quote.poolId).toBeDefined();
  });

  it('should accurately resolve DeepBook v3 pools and reject unlisted pairs', () => {
    const DEEP_TYPE = '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP';
    const USDT_TYPE = '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT';
    const WETH_TYPE = '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN';

    // Valid pools
    expect(DeepBookRouter.hasPool(SUI_TYPE, USDC_TYPE)).toBe(true);
    expect(DeepBookRouter.hasPool(DEEP_TYPE, SUI_TYPE)).toBe(true);
    expect(DeepBookRouter.hasPool(DEEP_TYPE, USDC_TYPE)).toBe(true);
    expect(DeepBookRouter.hasPool(USDT_TYPE, USDC_TYPE)).toBe(true);

    // Unlisted pairs should strictly return null and false, preventing dangerous pool fallthrough
    expect(DeepBookRouter.hasPool(WETH_TYPE, USDC_TYPE)).toBe(false);
    expect(DeepBookRouter.findPoolId(WETH_TYPE, USDC_TYPE)).toBeNull();
    expect(() => DeepBookRouter.getQuote(WETH_TYPE, USDC_TYPE, 1000n)).toThrow();
  });

  it('should build DeepBook v3 PTB swap with 3-tuple destructuring and residual coin sweeping', () => {
    const tx = new Transaction();
    const mockInputCoin = tx.object('0x1111111111111111111111111111111111111111111111111111111111111111');
    const quote = DeepBookRouter.getQuote(SUI_TYPE, USDC_TYPE, 100_000_000_000n, 100);

    const outCoin = DeepBookRouter.addSwap(tx, quote, mockInputCoin);
    expect(outCoin).toBeDefined();

    const commands = tx.getData().commands;
    // Verify DeepBook MoveCall and TransferObjects (for residual coins)
    const moveCalls = commands.filter((c: any) => c.$kind === 'MoveCall');
    const transfers = commands.filter((c: any) => c.$kind === 'TransferObjects');

    expect(moveCalls.length).toBeGreaterThanOrEqual(2); // coin::zero + pool::swap_exact_base_for_quote
    expect(transfers.length).toBeGreaterThanOrEqual(1); // Leftover and DEEP fee swept to operator
  });
});
