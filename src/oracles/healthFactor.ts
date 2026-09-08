import { CollateralPosition, DebtPosition, LiquidationOpportunity, ObligationState } from '../config/types.js';
import { COIN_CONFIGS, getCoinConfigByType } from '../config/coins.js';
import { priceCache } from './priceCache.js';
import { CONFIG } from '../config/index.js';
import { CetusRouter } from '../protocols/dex/cetusRouter.js';
import { DeepBookRouter } from '../protocols/dex/deepbookRouter.js';

/**
 * Health Factor & Liquidation Math Engine
 */
export class HealthFactorEngine {
  /**
   * Recalculate health factor and USD values for an obligation given current prices
   */
  public static evaluateObligation(obligation: ObligationState): ObligationState {
    let totalCollateralUsd = 0;
    let liquidationThresholdCollateralUsd = 0;
    let totalDebtUsd = 0;

    // Recalculate collateral positions
    for (const col of obligation.collaterals) {
      const price = priceCache.getPriceUsd(col.coinType);
      const normAmount = Number(col.amount) / Math.pow(10, col.decimals);
      col.valueUsd = normAmount * price;

      totalCollateralUsd += col.valueUsd;
      liquidationThresholdCollateralUsd += col.valueUsd * col.liquidationThreshold;
    }

    // Recalculate debt positions
    for (const debt of obligation.debts) {
      const price = priceCache.getPriceUsd(debt.coinType);
      const normAmount = Number(debt.amount) / Math.pow(10, debt.decimals);
      debt.valueUsd = normAmount * price;

      totalDebtUsd += debt.valueUsd;
    }

    obligation.totalCollateralUsd = totalCollateralUsd;
    obligation.totalDebtUsd = totalDebtUsd;
    obligation.liquidationThresholdCollateralUsd = liquidationThresholdCollateralUsd;

    // Health factor calculation
    // HF = sum(Collateral_i * LiquidationThreshold_i) / TotalDebt
    const healthFactor = totalDebtUsd > 0
      ? liquidationThresholdCollateralUsd / totalDebtUsd
      : Infinity;

    obligation.healthFactor = healthFactor;
    obligation.isLiquidatable = healthFactor < 1.0 && totalDebtUsd > 0.01;
    obligation.lastUpdatedMs = Date.now();

    return obligation;
  }

  /**
   * Find the most profitable liquidation pair (debt to repay vs collateral to seize)
   */
  public static findBestLiquidationOpportunity(
    obligation: ObligationState,
    closeFactor: number = CONFIG.liquidationCloseFactor
  ): LiquidationOpportunity | null {
    if (!obligation.isLiquidatable || obligation.debts.length === 0 || obligation.collaterals.length === 0) {
      return null;
    }

    let bestOpportunity: LiquidationOpportunity | null = null;

    // Search across all debt and collateral combinations to find the highest-profit valid pair
    for (const targetDebt of obligation.debts) {
      for (const targetCollateral of obligation.collaterals) {
        // Check DEX route availability on Cetus and DeepBook
        const hasCetusRoute = CetusRouter.hasPool(targetCollateral.coinType, targetDebt.coinType);
        const hasDeepBookRoute = DeepBookRouter.hasPool(targetCollateral.coinType, targetDebt.coinType);
        const isSameAsset = targetCollateral.coinType.toLowerCase() === targetDebt.coinType.toLowerCase();

        if (!hasCetusRoute && !hasDeepBookRoute && !isSameAsset) continue;

        // Determine best DEX
        let selectedDex: 'cetus' | 'deepbook' = 'cetus';
        if (CONFIG.preferredDex === 'deepbook') {
          selectedDex = hasDeepBookRoute ? 'deepbook' : 'cetus';
        } else {
          selectedDex = hasCetusRoute ? 'cetus' : 'deepbook';
        }

        const debtPrice = priceCache.getPriceUsd(targetDebt.coinType);
        const colPrice = priceCache.getPriceUsd(targetCollateral.coinType);
        if (debtPrice <= 0 || colPrice <= 0) continue;

        // Compute maximum repayable debt based on close factor (e.g. 50% max)
        const maxRepayAmount = (targetDebt.amount * BigInt(Math.floor(closeFactor * 10000))) / 10000n;
        if (maxRepayAmount <= 0n) continue;

        // Liquidation bonus: usually 5% - 8% based on collateral token
        const colCfg = getCoinConfigByType(targetCollateral.coinType);
        const liquidationBonus = colCfg?.liquidationBonus ?? 0.05;

        // Calculate theoretical collateral seized for maxRepayAmount
        const normMaxRepay = Number(maxRepayAmount) / Math.pow(10, targetDebt.decimals);
        const maxDebtRepayUsd = normMaxRepay * debtPrice;
        const maxCollateralReceiveUsd = maxDebtRepayUsd * (1 + liquidationBonus);
        const normMaxCollateralReceive = maxCollateralReceiveUsd / colPrice;
        const maxCollateralReceiveRaw = BigInt(Math.floor(normMaxCollateralReceive * Math.pow(10, targetCollateral.decimals)));

        // If target user collateral is less than max seize, scale down debt repay proportionally!
        let actualRepayAmount = maxRepayAmount;
        let actualCollateralToReceive = maxCollateralReceiveRaw;

        if (maxCollateralReceiveRaw > targetCollateral.amount) {
          actualCollateralToReceive = targetCollateral.amount;
          const normColSeize = Number(actualCollateralToReceive) / Math.pow(10, targetCollateral.decimals);
          const colSeizeUsd = normColSeize * colPrice;
          const matchedDebtUsd = colSeizeUsd / (1 + liquidationBonus);
          const matchedDebtUnits = Math.floor((matchedDebtUsd / debtPrice) * Math.pow(10, targetDebt.decimals));
          actualRepayAmount = BigInt(matchedDebtUnits);
        }

        if (actualRepayAmount <= 0n || actualCollateralToReceive <= 0n) continue;

        const normRepay = Number(actualRepayAmount) / Math.pow(10, targetDebt.decimals);
        const debtRepayUsd = normRepay * debtPrice;
        const normSeize = Number(actualCollateralToReceive) / Math.pow(10, targetCollateral.decimals);
        const collateralReceiveUsd = normSeize * colPrice;
        const expectedGrossProfitUsd = collateralReceiveUsd - debtRepayUsd;

        if (expectedGrossProfitUsd <= 0) continue;

        if (!bestOpportunity || expectedGrossProfitUsd > bestOpportunity.expectedGrossProfitUsd) {
          bestOpportunity = {
            protocol: obligation.protocol,
            obligation,
            debtCoinType: targetDebt.coinType,
            debtSymbol: targetDebt.symbol,
            debtAmountToRepay: actualRepayAmount,
            debtRepayUsd,
            collateralCoinType: targetCollateral.coinType,
            collateralSymbol: targetCollateral.symbol,
            collateralToReceive: actualCollateralToReceive,
            collateralReceiveUsd,
            expectedGrossProfitUsd,
            dex: selectedDex,
            liquidationBonus,
          };
        }
      }
    }

    return bestOpportunity;
  }
}
