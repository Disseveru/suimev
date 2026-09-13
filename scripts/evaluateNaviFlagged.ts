import chalk from 'chalk';
import { suiClient } from '../src/client/suiClient.js';
import { getLendingPositions } from '@naviprotocol/lending';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';

// Extract all 29 addresses from task-1112 log
import fs from 'fs';

async function main() {
  await naviProtocol.initialize();
  const log = fs.readFileSync('C:/Users/mrmou/.gemini/antigravity/brain/f938b0d1-eb32-4fb8-912f-cd60d688bf81/.system_generated/tasks/task-1112.log', 'utf8');
  const regex = /0x[a-fA-F0-9]{64}/g;
  const matches = log.match(regex) || [];
  const uniqueAddrs = Array.from(new Set(matches));
  console.log(`Found ${uniqueAddrs.length} unique addresses in log`);

  const realOpportunities: any[] = [];

  for (const addr of uniqueAddrs) {
    try {
      const positions = await getLendingPositions(addr, { client: suiClient as any });
      const supplies = positions.filter((p: any) => p.type === 'navi-lending-supply');
      const borrows = positions.filter((p: any) => p.type === 'navi-lending-borrow');

      if (supplies.length > 0 && borrows.length > 0) {
        let totalColUsd = 0;
        let totalDebtUsd = 0;
        let totalLtColUsd = 0;

        for (const s of supplies) {
          const supply = s['navi-lending-supply'];
          const val = Number(supply.valueUSD || 0);
          totalColUsd += val;
          const lt = Number(supply.pool?.liquidationFactor?.threshold || 0.8);
          totalLtColUsd += val * lt;
        }

        for (const b of borrows) {
          const borrow = b['navi-lending-borrow'];
          const val = Number(borrow.valueUSD || 0);
          totalDebtUsd += val;
        }

        const hf = totalDebtUsd > 0 ? totalLtColUsd / totalDebtUsd : Infinity;

        if (hf < 1.0 && totalColUsd > 0.1) {
          console.log(chalk.bold.red(`\n🚨 REAL UNDERCOLLATERALIZED POSITION FOUND: ${addr}`));
          console.log(`   HF: ${hf.toFixed(4)} | Collateral: $${totalColUsd.toFixed(2)} | Debt: $${totalDebtUsd.toFixed(2)}`);
          for (const s of supplies) {
            const supply = s['navi-lending-supply'];
            console.log(`   Col: ${supply.amount} ${supply.token?.symbol} ($${Number(supply.valueUSD).toFixed(2)})`);
          }
          for (const b of borrows) {
            const borrow = b['navi-lending-borrow'];
            console.log(`   Debt: ${borrow.amount} ${borrow.token?.symbol} ($${Number(borrow.valueUSD).toFixed(2)})`);
          }
          realOpportunities.push({ addr, hf, supplies, borrows, totalColUsd, totalDebtUsd });
        }
      }
    } catch {}
  }

  console.log(chalk.bold.green(`\n\nTotal genuine undercollateralized accounts with active collateral & debt: ${realOpportunities.length}`));
}

main().catch(console.error);
