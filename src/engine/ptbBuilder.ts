import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { LiquidationOpportunity } from '../config/types.js';
import { CONFIG } from '../config/index.js';
import { getCoinConfigByType } from '../config/coins.js';
import { naviProtocol } from '../protocols/navi/naviProtocol.js';
import { NaviPtbBuilder } from '../protocols/navi/naviPtb.js';
import { ScallopPtbBuilder } from '../protocols/scallop/scallopPtb.js';
import { CetusRouter } from '../protocols/dex/cetusRouter.js';
import { DeepBookRouter } from '../protocols/dex/deepbookRouter.js';

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

      // Flash loan debt asset
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
}
