import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { NAVI_CONFIG, SUI_CLOCK_OBJECT_ID, SUI_SYSTEM_STATE_OBJECT_ID } from '../../config/constants.js';
import { getCoinConfigByType } from '../../config/coins.js';

import { CONFIG } from '../../config/index.js';

export interface NaviFlashLoanResult {
  loanCoin: TransactionObjectArgument;
  receipt: TransactionObjectArgument;
}

/**
 * NAVI Protocol Zero-Contract PTB Builder
 * Low-level Move call construction for Flash Loans, Liquidations, and Repayment.
 */
export class NaviPtbBuilder {
  /**
   * Add NAVI Flash Loan to PTB
   */
  public static addFlashLoan(
    tx: Transaction,
    coinType: string,
    poolContract: string,
    amount: bigint
  ): NaviFlashLoanResult {
    const [loanCoin, receipt] = tx.moveCall({
      target: `${NAVI_CONFIG.packageId}::lending::flash_loan_with_ctx_v2`,
      arguments: [
        tx.object(NAVI_CONFIG.flashloanConfig),
        tx.object(poolContract),
        tx.pure.u64(amount),
        tx.object(SUI_SYSTEM_STATE_OBJECT_ID),
      ],
      typeArguments: [coinType],
    });

    return { loanCoin, receipt };
  }

  /**
   * Add NAVI Liquidation to PTB
   * Seizes collateral in exchange for paying off borrower's debt
   */
  public static addLiquidate(
    tx: Transaction,
    debtCoinType: string,
    debtAssetId: number,
    debtPoolContract: string,
    debtCoinInput: TransactionObjectArgument,
    collateralCoinType: string,
    collateralAssetId: number,
    collateralPoolContract: string,
    borrowerAddress: string
  ): [TransactionObjectArgument, TransactionObjectArgument] {
    const [collateralBalance, leftoverDebtBalance] = tx.moveCall({
      target: `${NAVI_CONFIG.packageId}::incentive_v3::liquidation_v2`,
      arguments: [
        tx.object(SUI_CLOCK_OBJECT_ID),
        tx.object(NAVI_CONFIG.priceOracle),
        tx.object(NAVI_CONFIG.storage),
        tx.pure.u8(debtAssetId),
        tx.object(debtPoolContract),
        debtCoinInput,
        tx.pure.u8(collateralAssetId),
        tx.object(collateralPoolContract),
        tx.pure.address(borrowerAddress),
        tx.object(NAVI_CONFIG.incentiveV2),
        tx.object(NAVI_CONFIG.incentiveV3),
        tx.object(SUI_SYSTEM_STATE_OBJECT_ID),
      ],
      typeArguments: [debtCoinType, collateralCoinType],
    });

    const collateralCoin = tx.moveCall({
      target: '0x2::coin::from_balance',
      arguments: [collateralBalance],
      typeArguments: [collateralCoinType],
    });

    const leftoverDebtCoin = tx.moveCall({
      target: '0x2::coin::from_balance',
      arguments: [leftoverDebtBalance],
      typeArguments: [debtCoinType],
    });

    return [collateralCoin, leftoverDebtCoin];
  }

  /**
   * Add NAVI Flash Loan Repayment to PTB
   */
  public static addRepayFlashLoan(
    tx: Transaction,
    coinType: string,
    poolContract: string,
    repayCoinInput: TransactionObjectArgument,
    receiptInput: TransactionObjectArgument
  ): TransactionObjectArgument {
    const repayBalance = tx.moveCall({
      target: '0x2::coin::into_balance',
      arguments: [repayCoinInput],
      typeArguments: [coinType],
    });

    const [repayResult] = tx.moveCall({
      target: `${NAVI_CONFIG.packageId}::lending::flash_repay_with_ctx`,
      arguments: [
        tx.object(SUI_CLOCK_OBJECT_ID),
        tx.object(NAVI_CONFIG.storage),
        tx.object(poolContract),
        receiptInput,
        repayBalance,
      ],
      typeArguments: [coinType],
    });

    // On Sui Move, Balance<T> does not have the drop ability.
    // Convert excess returned balance to Coin<T> and transfer to operator
    const excessCoin = tx.moveCall({
      target: '0x2::coin::from_balance',
      arguments: [repayResult],
      typeArguments: [coinType],
    });

    tx.transferObjects([excessCoin], tx.pure.address(CONFIG.operatorAddress));
    return excessCoin;
  }
}
