export interface EvmPosition {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  amount: bigint;
  priceUsd: number;
  valueUsd: number;
  liquidationThreshold?: number; // e.g. 0.85 (85%)
}

export interface EvmObligationState {
  borrower: `0x${string}`;
  collaterals: EvmPosition[];
  debts: EvmPosition[];
  totalCollateralUsd: number;
  totalDebtUsd: number;
  liquidationThresholdCollateralUsd: number;
  healthFactor: number;
  isLiquidatable: boolean;
}

export interface EvmLiquidationOpportunity {
  borrower: `0x${string}`;
  debtAsset: `0x${string}`;
  debtSymbol: string;
  collateralAsset: `0x${string}`;
  collateralSymbol: string;
  debtAmountToRepay: bigint;
  collateralToReceive: bigint;
  debtRepayUsd: number;
  collateralReceiveUsd: number;
  expectedGrossProfitUsd: number;
  estimatedGasCostUsd: number;
  netProfitUsd: number;
}

export class EvmHealthFactorEngine {
  /**
   * Calculate Health Factor for an EVM lending borrower
   * HF = (Sum of Collateral in USD * Liquidation Threshold) / (Sum of Debt in USD)
   */
  public static evaluateObligation(obligation: EvmObligationState): void {
    let totalColUsd = 0;
    let ltColUsd = 0;
    let totalDebtUsd = 0;

    for (const col of obligation.collaterals) {
      const normAmt = Number(col.amount) / Math.pow(10, col.decimals);
      col.valueUsd = normAmt * col.priceUsd;
      totalColUsd += col.valueUsd;
      ltColUsd += col.valueUsd * (col.liquidationThreshold ?? 0.80);
    }

    for (const d of obligation.debts) {
      const normAmt = Number(d.amount) / Math.pow(10, d.decimals);
      d.valueUsd = normAmt * d.priceUsd;
      totalDebtUsd += d.valueUsd;
    }

    obligation.totalCollateralUsd = totalColUsd;
    obligation.liquidationThresholdCollateralUsd = ltColUsd;
    obligation.totalDebtUsd = totalDebtUsd;

    if (totalDebtUsd === 0) {
      obligation.healthFactor = Infinity;
      obligation.isLiquidatable = false;
    } else {
      obligation.healthFactor = ltColUsd / totalDebtUsd;
      obligation.isLiquidatable = obligation.healthFactor < 1.0;
    }
  }

  /**
   * Find the most profitable liquidation opportunity for an undercollateralized obligation
   * Strictly enforces the collateral-constrained scaling invariant to prevent liquidator over-repayment.
   */
  public static findBestOpportunity(
    obligation: EvmObligationState,
    closeFactor: number = 0.50,
    liquidationBonus: number = 0.05
  ): EvmLiquidationOpportunity | null {
    if (!obligation.isLiquidatable) return null;

    const targetDebt = obligation.debts.reduce((max, d) => (d.valueUsd > max.valueUsd ? d : max), obligation.debts[0]);
    const targetCollateral = obligation.collaterals.reduce((max, c) => (c.valueUsd > max.valueUsd ? c : max), obligation.collaterals[0]);

    if (!targetDebt || !targetCollateral || targetDebt.amount === 0n || targetCollateral.amount === 0n) {
      return null;
    }

    const closeFactorBps = BigInt(Math.floor(closeFactor * 10000));
    let debtAmountToRepay = (targetDebt.amount * closeFactorBps) / 10000n;

    const normRepay = Number(debtAmountToRepay) / Math.pow(10, targetDebt.decimals);
    const repayUsd = normRepay * targetDebt.priceUsd;

    // Seize value = repayUsd * (1 + bonus)
    const seizeUsd = repayUsd * (1 + liquidationBonus);
    const normSeize = seizeUsd / targetCollateral.priceUsd;
    let collateralToReceive = BigInt(Math.floor(normSeize * Math.pow(10, targetCollateral.decimals)));

    // Collateral-constrained invariant: If borrower has less collateral than max close factor, scale debt down!
    if (collateralToReceive > targetCollateral.amount) {
      collateralToReceive = targetCollateral.amount;
      const actualNormCol = Number(collateralToReceive) / Math.pow(10, targetCollateral.decimals);
      const actualColUsd = actualNormCol * targetCollateral.priceUsd;
      const matchedDebtUsd = actualColUsd / (1 + liquidationBonus);
      debtAmountToRepay = BigInt(Math.floor((matchedDebtUsd / targetDebt.priceUsd) * Math.pow(10, targetDebt.decimals)));
    }

    const finalRepayUsd = (Number(debtAmountToRepay) / Math.pow(10, targetDebt.decimals)) * targetDebt.priceUsd;
    const finalSeizeUsd = (Number(collateralToReceive) / Math.pow(10, targetCollateral.decimals)) * targetCollateral.priceUsd;
    const expectedGrossProfitUsd = finalSeizeUsd - finalRepayUsd;

    if (expectedGrossProfitUsd <= 0) return null;

    return {
      borrower: obligation.borrower,
      debtAsset: targetDebt.asset,
      debtSymbol: targetDebt.symbol,
      collateralAsset: targetCollateral.asset,
      collateralSymbol: targetCollateral.symbol,
      debtAmountToRepay,
      collateralToReceive,
      debtRepayUsd: finalRepayUsd,
      collateralReceiveUsd: finalSeizeUsd,
      expectedGrossProfitUsd,
      estimatedGasCostUsd: 0.005, // EVM L1/L2 estimate on Sei/Monad
      netProfitUsd: expectedGrossProfitUsd - 0.005,
    };
  }
}
