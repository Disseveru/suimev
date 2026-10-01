import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { SCALLOP_CONFIG, SUI_CLOCK_OBJECT_ID } from '../../config/constants.js';
import { CetusRouter } from '../dex/cetusRouter.js';
import { DeepBookRouter } from '../dex/deepbookRouter.js';

export interface ScallopFlashLoanResult {
  loanCoin: TransactionObjectArgument;
  receipt: TransactionObjectArgument;
}

export interface ScallopLiquidateResult {
  collateralCoin: TransactionObjectArgument;
  leftoverDebtCoin: TransactionObjectArgument;
}

export interface BuildScallopLiquidationParams {
  tx?: Transaction;
  obligationId: string;
  debtCoinType: string;
  collateralCoinType: string;
  debtAmountToRepay: bigint;
  expectedCollateralAmount?: bigint;
  recipientAddress: string;
  isLocked?: boolean;
  dex?: 'cetus' | 'deepbook';
  maxSlippageBps?: number;
}

export interface ScallopCompleteLiquidationResult {
  tx: Transaction;
  collateralCoin: TransactionObjectArgument;
  leftoverDebtCoin: TransactionObjectArgument;
  profitCoin: TransactionObjectArgument;
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
   * Pays debt asset to liquidate undercollateralized obligation and receive collateral.
   *
   * On-chain Move signature:
   * public fun liquidate<DebtType, CollateralType>(
   *   version: &Version,
   *   obligation: &mut Obligation,
   *   market: &mut Market,
   *   available_repay_coin: Coin<DebtType>,
   *   coin_decimals_registry: &CoinDecimalsRegistry,
   *   x_oracle: &XOracle,
   *   clock: &Clock,
   *   ctx: &mut TxContext,
   * ): (Coin<DebtType>, Coin<CollateralType>)
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

    // Returns [collateralCoin, leftoverDebtCoin]
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

  /**
   * Add Scallop Force Unstake Unhealthy (for obligations locked in borrow incentives)
   * Must be called before liquidate if obligation.liquidate_locked == true
   */
  public static addForceUnstakeUnhealthy(
    tx: Transaction,
    obligationId: string,
    overrides?: Partial<typeof SCALLOP_CONFIG>
  ): void {
    const cfg = { ...SCALLOP_CONFIG, ...overrides };
    tx.moveCall({
      target: `${cfg.borrowIncentivePkg}::user::force_unstake_unhealthy_v3`,
      arguments: [
        tx.object(cfg.borrowIncentiveConfig),
        tx.object(cfg.borrowIncentivePools),
        tx.object(cfg.borrowIncentiveAccounts),
        tx.object(cfg.version),
        tx.object(obligationId),
        tx.object(cfg.market),
        tx.object(cfg.coinDecimalsRegistry),
        tx.object(cfg.xOracle),
        tx.object(cfg.vescaSubsTable),
        tx.object(cfg.vescaSubsWhitelist),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
  }

  /**
   * Build a complete Zero-Capital Atomic Scallop Liquidation PTB:
   *   [Unlock Incentive Account (if locked)]
   *   -> [Scallop Flash Loan Borrow]
   *   -> [Scallop Liquidate]
   *   -> [DEX Swap (Collateral -> Debt)]
   *   -> [Repay Flash Loan]
   *   -> [Transfer Net Profit to Recipient]
   */
  public static buildCompleteLiquidation(
    params: BuildScallopLiquidationParams
  ): ScallopCompleteLiquidationResult {
    const tx = params.tx ?? new Transaction();
    const slippageBps = params.maxSlippageBps ?? 50;

    // 1. Force unstake from borrow incentive pool if obligation is locked
    if (params.isLocked) {
      this.addForceUnstakeUnhealthy(tx, params.obligationId);
    }

    // 2. Borrow flash loan for exact debt repayment amount (0 fee on Scallop)
    const { loanCoin, receipt } = this.addFlashLoan(
      tx,
      params.debtCoinType,
      params.debtAmountToRepay
    );

    // 3. Execute liquidation
    const [collateralCoin, leftoverDebtCoin] = this.addLiquidate(
      tx,
      params.obligationId,
      loanCoin,
      params.debtCoinType,
      params.collateralCoinType
    );

    // 4. Swap collateral for debt asset
    let swappedDebtCoin: TransactionObjectArgument;
    if (params.collateralCoinType.toLowerCase() === params.debtCoinType.toLowerCase()) {
      // Same-asset liquidation bypass: No swap needed
      swappedDebtCoin = collateralCoin;
    } else if (params.dex === 'deepbook' && DeepBookRouter.hasPool(params.collateralCoinType, params.debtCoinType)) {
      const quote = DeepBookRouter.getQuote(
        params.collateralCoinType,
        params.debtCoinType,
        params.expectedCollateralAmount ?? 0n,
        slippageBps
      );
      swappedDebtCoin = DeepBookRouter.addSwap(tx, quote, collateralCoin);
    } else {
      const quote = CetusRouter.getQuote(
        params.collateralCoinType,
        params.debtCoinType,
        params.expectedCollateralAmount ?? 0n,
        slippageBps
      );
      swappedDebtCoin = CetusRouter.addSwap(tx, quote, collateralCoin);
    }

    // Merge any unconsumed leftover debt coin back into swappedDebtCoin
    tx.mergeCoins(swappedDebtCoin, [leftoverDebtCoin]);

    // 5. Split repayment coin for flash loan
    const [repayCoin] = tx.splitCoins(swappedDebtCoin, [
      tx.pure.u64(params.debtAmountToRepay),
    ]);

    // 6. Repay flash loan
    this.addRepayFlashLoan(tx, params.debtCoinType, receipt, repayCoin);

    // 7. Transfer remaining profit coin to recipient
    tx.transferObjects([swappedDebtCoin], tx.pure.address(params.recipientAddress));

    return {
      tx,
      collateralCoin,
      leftoverDebtCoin,
      profitCoin: swappedDebtCoin,
    };
  }
}

