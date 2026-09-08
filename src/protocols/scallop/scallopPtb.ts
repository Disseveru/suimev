import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { SCALLOP_CONFIG, SUI_CLOCK_OBJECT_ID } from '../../config/constants.js';

export interface ScallopFlashLoanResult {
  loanCoin: TransactionObjectArgument;
  receipt: TransactionObjectArgument;
}

/**
 * Scallop Protocol Zero-Contract PTB Builder
 * Move call chaining for Scallop Flash Loans, Liquidations, and Repayment.
 */
export class ScallopPtbBuilder {
  /**
   * Add Scallop Flash Loan to PTB
   */
  public static addFlashLoan(
    tx: Transaction,
    coinType: string,
    amount: bigint
  ): ScallopFlashLoanResult {
    const [loanCoin, receipt] = tx.moveCall({
      target: `${SCALLOP_CONFIG.protocolPkg}::flash_loan::borrow_flash_loan`,
      arguments: [
        tx.object(SCALLOP_CONFIG.version),
        tx.object(SCALLOP_CONFIG.market),
        tx.pure.u64(amount),
      ],
      typeArguments: [coinType],
    });

    return { loanCoin, receipt };
  }

  /**
   * Add Scallop Liquidation call to PTB
   * Pays debt asset to liquidate undercollateralized obligation and receive collateral
   */
  public static addLiquidate(
    tx: Transaction,
    obligationId: string,
    debtCoinInput: TransactionObjectArgument,
    debtCoinType: string,
    collateralCoinType: string
  ): [TransactionObjectArgument, TransactionObjectArgument] {
    const [leftoverDebt, collateralCoin] = tx.moveCall({
      target: `${SCALLOP_CONFIG.protocolPkg}::liquidate::liquidate`,
      arguments: [
        tx.object(SCALLOP_CONFIG.version),
        tx.object(obligationId),
        tx.object(SCALLOP_CONFIG.market),
        debtCoinInput,
        tx.object(SCALLOP_CONFIG.coinDecimalsRegistry),
        tx.object(SCALLOP_CONFIG.xOracle),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
      typeArguments: [debtCoinType, collateralCoinType],
    });

    return [collateralCoin, leftoverDebt];
  }

  /**
   * Add Scallop Flash Loan Repayment to PTB
   */
  public static addRepayFlashLoan(
    tx: Transaction,
    coinType: string,
    receiptInput: TransactionObjectArgument,
    repayCoinInput: TransactionObjectArgument
  ): void {
    tx.moveCall({
      target: `${SCALLOP_CONFIG.protocolPkg}::flash_loan::repay_flash_loan`,
      arguments: [
        tx.object(SCALLOP_CONFIG.version),
        tx.object(SCALLOP_CONFIG.market),
        repayCoinInput,
        receiptInput,
      ],
      typeArguments: [coinType],
    });
  }
}
