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
import { AstrosRouter } from '../protocols/dex/astrosRouter.js';
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
    if (opportunity.obligation.healthFactor >= 1.0) {
      throw new Error(`Zero-capital solvency guard triggered: Borrower HF ${opportunity.obligation.healthFactor} >= 1.0 (Safe)`);
    }
    if (opportunity.obligation.totalCollateralUsd <= 0 || opportunity.collateralToReceive <= 0n) {
      throw new Error(`Zero-capital bad debt guard triggered: Borrower has zero collateral. Aborting.`);
    }
    if (opportunity.obligation.totalDebtUsd < 0.01 || opportunity.debtAmountToRepay <= 0n) {
      throw new Error(`Zero-capital dust guard triggered: Debt amount below $0.01 threshold. Aborting.`);
    }

    const tx = existingTx ?? new Transaction();
    tx.setSender(CONFIG.operatorAddress);
    tx.setGasBudget(BigInt(CONFIG.gasBudget));

    const debtCoinType = opportunity.debtCoinType;
    const collateralCoinType = opportunity.collateralCoinType;
    const debtAmountToRepay = opportunity.debtAmountToRepay;

    // Flash loan fees: NAVI and Scallop both charge 0 bps (verified via NAVI OpenAPI /api/navi/flashloan & Scallop contracts)
    // TODO: Discrepancy Note: NAVI documentation and legacy SDK specs historically referenced a 5 bps (0.05%) flash loan fee.
    // However, on-chain execution and current NAVI OpenAPI endpoints (`/api/navi/flashloan`) confirm that NAVI currently enforces 0 bps (fee = 0).
    // If NAVI updates on-chain contract state to re-enable a 5 bps fee, flashLoanFeeBps should be dynamically set to 5n for NAVI,
    // requiring totalDebtNeededToRepayLoan = debtAmountToRepay + (debtAmountToRepay * 5n) / 10000n.
    const flashLoanFeeBps = 0n;
    const estimatedFlashLoanFee = 0n;
    const totalDebtNeededToRepayLoan = debtAmountToRepay;

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
        tx.transferObjects([collateralCoinFromBal], tx.pure.address(CONFIG.operatorAddress));
        tx.transferObjects([leftoverDebtCoinFromBal], tx.pure.address(CONFIG.operatorAddress));
        tx.transferObjects([emptyCoin], tx.pure.address(CONFIG.operatorAddress));

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

  // Reusable SuiPythClient instance to avoid repeated instantiation on hot paths
  private static cachedPythClient: any = null;

  private static async getPythClient(): Promise<any> {
    if (!this.cachedPythClient) {
      const { SuiPythClient } = await import('@pythnetwork/pyth-sui-js');
      const { rpcManager } = await import('../client/suiClient.js');
      this.cachedPythClient = new SuiPythClient(
        (rpcManager.getClient() as any),
        '0x1f9310238ee9298fb703c3419030b35b22bb1cc37113e3bb5007c99aec79e5b8', // Mainnet Pyth State ID
        '0x31358d198147da50db32eda2562951d53cd27f59d66ceda83b06900fdfbbf528'  // Mainnet Wormhole State ID
      );
    }
    return this.cachedPythClient;
  }

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
        const oblId = opportunity.obligation.obligationId;
        const dynamicCoinNames = await scallopProtocol.getObligationCoinNames(oblId);
        const exactCoinNames = new Set<string>(dynamicCoinNames);

        const allTypes = [
          ...opportunity.obligation.collaterals.filter(c => c.amount > 0n).map(c => c.coinType),
          ...opportunity.obligation.debts.filter(d => d.amount > 0n).map(d => d.coinType),
          opportunity.debtCoinType,
          opportunity.collateralCoinType,
        ];
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
          // AGENTS.md §9.2 Abort 2 Guard: Calling force_unstake_unhealthy on an obligation with
          // on-chain riskLevel < 1.0 aborts with Move error 2 (obligation_is_healthy).
          const riskInfo = await scallopProtocol.getOnChainObligationRisk(oblId);
          if (!riskInfo.isLiquidatable) {
            throw new Error(`Abort 2 Guard: Scallop on-chain riskLevel ${riskInfo.riskLevel.toFixed(4)} < 1.0 (account is healthy on-chain per AGENTS.md §9.2)`);
          }
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
        const feedIds = [
          ...opportunity.obligation.collaterals.map(c => getCoinConfigByType(c.coinType)?.pythPriceFeedId),
          ...opportunity.obligation.debts.map(d => getCoinConfigByType(d.coinType)?.pythPriceFeedId),
          getCoinConfigByType(opportunity.debtCoinType)?.pythPriceFeedId,
          getCoinConfigByType(opportunity.collateralCoinType)?.pythPriceFeedId,
        ].filter(Boolean) as string[];

        const uniqueFeedIds = Array.from(new Set(feedIds));
        
        if (uniqueFeedIds.length > 0) {
          const { pythService } = await import('../oracles/pythService.js');
          const pythClient = await this.getPythClient();

          // Get binary VAA payloads using the local service
          const vaaData = await pythService.getPriceUpdateDataForPTB(uniqueFeedIds);

          if (vaaData.length > 0) {
             const vaaBuffers = vaaData.map((d: string) => Buffer.from(d, 'base64'));
             await pythClient.updatePriceFeeds(tx, vaaBuffers, uniqueFeedIds);
          }
        }

        // Must still call Navi's xOracle update to pull the fresh Pyth price into Navi's state
        const poolList = await (navi as any).getPools();
        await (navi as any).updateOraclePriceBeforeUserOperationPTB(
          tx,
          opportunity.obligation.ownerAddress,
          poolList
        );
      } catch (err: any) {
        logger.error({ error: err?.message, stack: err?.stack }, 'Failed to fetch and inject Pyth VAAs for NAVI PTB');
      }
      return this.buildLiquidationPTB(opportunity, tx);
    }

    return this.buildLiquidationPTB(opportunity);
  }
}
