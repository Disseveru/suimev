import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { LiquidationOpportunity } from '../config/types.js';
import { CONFIG } from '../config/index.js';
import { getCoinConfigByType } from '../config/coins.js';
import { naviProtocol } from '../protocols/navi/naviProtocol.js';
import { NaviPtbBuilder } from '../protocols/navi/naviPtb.js';
import { ScallopPtbBuilder } from '../protocols/scallop/scallopPtb.js';
import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { CetusRouter } from '../protocols/dex/cetusRouter.js';
import { DeepBookRouter } from '../protocols/dex/deepbookRouter.js';
import * as navi from '@naviprotocol/lending';
import { logger } from '../ui/logger.js';

export interface BuiltLiquidationPTB {
  tx: Transaction;
  opportunity: LiquidationOpportunity;
  estimatedFlashLoanFee: bigint;
  expectedProfitDebtUnits: bigint;
}

/**
 * Unified Zero-Contract Programmable Transaction Block (PTB) Assembler
 *
 * Atomically links:
 *   [Flash Loan Borrow] -> [Protocol Liquidation] -> [DEX Atomic Swap] -> [Flash Loan Repay] -> [Profit Transfer]
 */
export class ZeroCapitalPtbBuilder {
  /**
   * Assemble atomic liquidation PTB for an opportunity
   */
  public static buildLiquidationPTB(
    opportunity: LiquidationOpportunity,
    existingTx?: Transaction
  ): BuiltLiquidationPTB {
    const tx = existingTx ?? new Transaction();
    tx.setSender(CONFIG.operatorAddress);
    tx.setGasBudget(BigInt(CONFIG.gasBudget));

    const debtCoinType = opportunity.debtCoinType;
    const collateralCoinType = opportunity.collateralCoinType;
    const debtAmountToRepay = opportunity.debtAmountToRepay;

    // Flash loan fees: NAVI is 5 bps (0.05%), Scallop is 0 bps (verified on-chain)
    const flashLoanFeeBps = opportunity.protocol === 'navi' ? 5n : 0n;
    const estimatedFlashLoanFee = (debtAmountToRepay * flashLoanFeeBps) / 10000n;
    const totalDebtNeededToRepayLoan = debtAmountToRepay + estimatedFlashLoanFee;

    let loanCoin: TransactionObjectArgument;
    let receipt: TransactionObjectArgument;
    let collateralCoin: TransactionObjectArgument;
    let leftoverDebtCoin: TransactionObjectArgument;

    // --------------------------------------------------------------------------
    // STEP 1: Flash Loan Borrow & Liquidation Call
    // --------------------------------------------------------------------------
    if (opportunity.protocol === 'navi') {
      const debtPool = naviProtocol.getPoolByCoinType(debtCoinType);
      const colPool = naviProtocol.getPoolByCoinType(collateralCoinType);

      if (!debtPool || !colPool) {
        throw new Error(`NAVI pool contract not found for ${opportunity.debtSymbol} or ${opportunity.collateralSymbol}`);
      }

      // Check if a direct Cetus CLMM pool exists for the (debt, collateral) pair
      const directCetusPool = CetusRouter.findPoolId(debtCoinType, collateralCoinType);

      if (directCetusPool) {
        // High-liquidity Cetus CLMM Flash Swap pipeline
        const flashSwap = CetusRouter.addFlashSwap(
          tx,
          directCetusPool.poolId,
          directCetusPool.coinTypeA,
          directCetusPool.coinTypeB,
          debtCoinType,
          debtAmountToRepay
        );

        // Liquidate NAVI borrower using the flash-swapped debt balance
        const [collateralBalance, leftoverDebtBalance] = NaviPtbBuilder.addLiquidateBalances(
          tx,
          debtCoinType,
          debtPool.id,
          debtPool.poolContract,
          flashSwap.loanBalance,
          collateralCoinType,
          colPool.id,
          colPool.poolContract,
          opportunity.obligation.ownerAddress
        );

        // Convert seized collateral balance to Coin
        const collateralCoinFromBal = tx.moveCall({
          target: '0x2::coin::from_balance',
          arguments: [collateralBalance],
          typeArguments: [collateralCoinType],
        });

        // Repay flash swap directly from the seized collateral coin (zero-capital!)
        const [repayCoin] = tx.splitCoins(collateralCoinFromBal, [flashSwap.payAmount]);
        const repayBalance = tx.moveCall({
          target: '0x2::coin::into_balance',
          arguments: [repayCoin],
          typeArguments: [collateralCoinType],
        });

        CetusRouter.addRepayFlashSwap(
          tx,
          directCetusPool.poolId,
          directCetusPool.coinTypeA,
          directCetusPool.coinTypeB,
          repayBalance,
          flashSwap.flashReceipt,
          flashSwap.a2b
        );

        // Convert leftover debt & empty balances to coins
        const leftoverDebtCoinFromBal = tx.moveCall({
          target: '0x2::coin::from_balance',
          arguments: [leftoverDebtBalance],
          typeArguments: [debtCoinType],
        });

        const emptyCoin = tx.moveCall({
          target: '0x2::coin::from_balance',
          arguments: [flashSwap.emptyBalance],
          typeArguments: [collateralCoinType],
        });

        // Transfer remaining collateralCoinFromBal (net profit!) and leftover dust to operator
        tx.transferObjects([collateralCoinFromBal, leftoverDebtCoinFromBal, emptyCoin], tx.pure.address(CONFIG.operatorAddress));

        const debtCfg = getCoinConfigByType(debtCoinType);
        const debtDecimals = debtCfg?.decimals ?? 6;
        const debtPrice = opportunity.debtRepayUsd / (Number(debtAmountToRepay) / Math.pow(10, debtDecimals)) || 1.0;
        const expectedProfitDebtUnits = BigInt(Math.floor((opportunity.expectedGrossProfitUsd / debtPrice) * Math.pow(10, debtDecimals)));

        return {
          tx,
          opportunity,
          estimatedFlashLoanFee: 0n,
          expectedProfitDebtUnits,
        };
      }

      // Fallback: Lending pool flash loan
      const naviLoan = NaviPtbBuilder.addFlashLoan(
        tx,
        debtCoinType,
        debtPool.poolContract,
        debtAmountToRepay
      );
      loanCoin = naviLoan.loanCoin;
      receipt = naviLoan.receipt;

      // Liquidate NAVI borrower
      const [receivedCol, leftoverDebt] = NaviPtbBuilder.addLiquidate(
        tx,
        debtCoinType,
        debtPool.id,
        debtPool.poolContract,
        loanCoin,
        collateralCoinType,
        colPool.id,
        colPool.poolContract,
        opportunity.obligation.ownerAddress
      );
      collateralCoin = receivedCol;
      leftoverDebtCoin = leftoverDebt;
    } else {
      // Scallop Protocol
      if (opportunity.obligation.liquidateLocked) {
        ScallopPtbBuilder.addForceUnstakeUnhealthy(tx, opportunity.obligation.obligationId);
      }

      const scallopLoan = ScallopPtbBuilder.addFlashLoan(
        tx,
        debtCoinType,
        debtAmountToRepay
      );
      loanCoin = scallopLoan.loanCoin;
      receipt = scallopLoan.receipt;

      // Liquidate Scallop obligation
      const [receivedCol, leftoverDebt] = ScallopPtbBuilder.addLiquidate(
        tx,
        opportunity.obligation.obligationId,
        loanCoin,
        debtCoinType,
        collateralCoinType
      );
      collateralCoin = receivedCol;
      leftoverDebtCoin = leftoverDebt;
    }

    // --------------------------------------------------------------------------
    // STEP 2: DEX Swap (Collateral Coin -> Debt Coin)
    // --------------------------------------------------------------------------
    let swappedDebtCoin: TransactionObjectArgument;

    if (collateralCoinType.toLowerCase() === debtCoinType.toLowerCase()) {
      // Same-asset liquidation bypass: No DEX swap required
      swappedDebtCoin = collateralCoin;
    } else if (opportunity.dex === 'deepbook' && DeepBookRouter.hasPool(collateralCoinType, debtCoinType)) {
      // DeepBook v3
      const swapQuote = DeepBookRouter.getQuote(
        collateralCoinType,
        debtCoinType,
        opportunity.collateralToReceive,
        CONFIG.maxSlippageBps
      );
      swappedDebtCoin = DeepBookRouter.addSwap(tx, swapQuote, collateralCoin);
    } else {
      // Cetus CLMM
      const swapQuote = CetusRouter.getQuote(
        collateralCoinType,
        debtCoinType,
        opportunity.collateralToReceive,
        CONFIG.maxSlippageBps
      );
      swappedDebtCoin = CetusRouter.addSwap(tx, swapQuote, collateralCoin);
    }

    // Merge any unconsumed leftover debt coin from liquidation back into swappedDebtCoin
    tx.mergeCoins(swappedDebtCoin, [leftoverDebtCoin]);

    // --------------------------------------------------------------------------
    // STEP 3: Split Debt Coin into (Repayment Coin) + (Profit Coin)
    // --------------------------------------------------------------------------
    const [repayCoin] = tx.splitCoins(swappedDebtCoin, [
      tx.pure.u64(totalDebtNeededToRepayLoan),
    ]);

    // --------------------------------------------------------------------------
    // STEP 4: Repay Flash Loan
    // --------------------------------------------------------------------------
    if (opportunity.protocol === 'navi') {
      const debtPool = naviProtocol.getPoolByCoinType(debtCoinType);
      if (debtPool) {
        NaviPtbBuilder.addRepayFlashLoan(
          tx,
          debtCoinType,
          debtPool.poolContract,
          repayCoin,
          receipt
        );
      }
    } else {
      ScallopPtbBuilder.addRepayFlashLoan(
        tx,
        debtCoinType,
        receipt,
        repayCoin
      );
    }

    // --------------------------------------------------------------------------
    // STEP 5: Retain Profit
    // The remaining balance in swappedDebtCoin is pure net MEV profit!
    // --------------------------------------------------------------------------
    tx.transferObjects([swappedDebtCoin], tx.pure.address(CONFIG.operatorAddress));

    const debtCfg = getCoinConfigByType(debtCoinType);
    const debtDecimals = debtCfg?.decimals ?? 6;
    const debtPrice = opportunity.debtRepayUsd / (Number(debtAmountToRepay) / Math.pow(10, debtDecimals)) || 1.0;
    const expectedProfitDebtUnits = BigInt(Math.floor((opportunity.expectedGrossProfitUsd / debtPrice) * Math.pow(10, debtDecimals)));

    return {
      tx,
      opportunity,
      estimatedFlashLoanFee,
      expectedProfitDebtUnits,
    };
  }

  // Obligation lock state cache — keyed by obligationId
  // Value: { isLocked: boolean; expiresMs: number }
  private static lockCache: Map<string, { isLocked: boolean; expiresMs: number }> = new Map();
  private static LOCK_CACHE_TTL_MS = 10_000; // 10 seconds

  /**
   * High-Level Async Liquidation PTB Builder
   * Automatically updates Pyth oracles and unlocks borrow-incentive positions if needed.
   * Uses a 10s TTL cache for obligation lock state to avoid redundant RPC round-trips.
   */
  public static async buildLiquidationPTBAsync(
    opportunity: LiquidationOpportunity
  ): Promise<BuiltLiquidationPTB> {
    if (opportunity.protocol === 'scallop') {
      try {
        const builder = await scallopProtocol.createScallopBuilder();
        const scallopTx = builder.createTxBlock();

        // 1. Update Pyth asset prices in xOracle for all assets in the target obligation
        // Note: Scallop requires fresh prices for ALL collateral and debt assets in the obligation
        // to evaluate health factor during force_unstake_unhealthy and liquidate without abort 1025.
        const allTypes = [
          ...opportunity.obligation.collaterals.filter(c => c.amount > 0n).map(c => c.coinType),
          ...opportunity.obligation.debts.filter(d => d.amount > 0n).map(d => d.coinType),
          opportunity.debtCoinType,
          opportunity.collateralCoinType,
        ];
        const exactCoinNames = new Set<string>();
        for (const coinType of allTypes) {
          try {
            const parsedName = (builder as any).utils?.parseCoinNameFromType?.(coinType);
            if (parsedName && typeof parsedName === 'string') {
              exactCoinNames.add(parsedName);
            }
          } catch {
            // fallback
          }
        }
        exactCoinNames.add(opportunity.debtSymbol.toLowerCase());
        exactCoinNames.add(opportunity.collateralSymbol.toLowerCase());
        const filteredCoins = Array.from(exactCoinNames).filter(c => c !== 'coin' && c !== 'unknown');
        if (filteredCoins.length > 0) {
          await scallopTx.updateAssetPricesQuick(filteredCoins, { isSponsoredTx: false });
        }

        // 2. Check obligation lock state — use TTL cache to skip extra RPC on retries
        const oblId = opportunity.obligation.obligationId;
        const cached = this.lockCache.get(oblId);
        const now = Date.now();
        let isLocked: boolean;

        if (cached && now < cached.expiresMs) {
          isLocked = cached.isLocked;
        } else {
          isLocked = await scallopProtocol.isObligationLocked(oblId);
          this.lockCache.set(oblId, { isLocked, expiresMs: now + this.LOCK_CACHE_TTL_MS });
        }

        if (isLocked) {
          ScallopPtbBuilder.addForceUnstakeUnhealthy(scallopTx.txBlock, oblId);
          // Invalidate cache once we've added the unlock instruction — recheck next time
          this.lockCache.delete(oblId);
        }

        return this.buildLiquidationPTB(opportunity, scallopTx.txBlock);
      } catch (err: any) {
        logger.error({ error: err?.message || err, stack: err?.stack }, 'Scallop SDK builder threw error in buildLiquidationPTBAsync');
        // Fall back to direct assembly if SDK builder fails
        const tx = new Transaction();
        const oblId = opportunity.obligation.obligationId;
        const isLocked = await scallopProtocol.isObligationLocked(oblId);
        if (isLocked) {
          ScallopPtbBuilder.addForceUnstakeUnhealthy(tx, oblId);
        }
        return this.buildLiquidationPTB(opportunity, tx);
      }
    }

    if (opportunity.protocol === 'navi') {
      const tx = new Transaction();
      try {
        const poolList = await (navi as any).getPools();
        await (navi as any).updateOraclePriceBeforeUserOperationPTB(
          tx,
          opportunity.obligation.ownerAddress,
          poolList
        );
      } catch (err) {
        // Fall back if offline or in mock test environment
      }
      return this.buildLiquidationPTB(opportunity, tx);
    }

    return this.buildLiquidationPTB(opportunity);
  }
}
