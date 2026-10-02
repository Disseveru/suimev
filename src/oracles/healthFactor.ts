import { CollateralPosition, DebtPosition, LiquidationOpportunity, ObligationState } from '../config/types.js';
import { COIN_CONFIGS, getCoinConfigByType } from '../config/coins.js';
import { priceCache } from './priceCache.js';
import { CONFIG } from '../config/index.js';
import { CetusRouter } from '../protocols/dex/cetusRouter.js';
import { DeepBookRouter } from '../protocols/dex/deepbookRouter.js';
import { naviProtocol } from '../protocols/navi/naviProtocol.js';

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

    const isNavi = obligation.protocol === 'navi';
    const isStable = (s: string) => {
      const sym = s.toUpperCase();
      return sym.includes('USD') || sym === 'BUCK';
    };
    const isSuiLst = (s: string) => {
      const sym = s.toUpperCase();
      return sym === 'SUI' || sym === 'VSUI' || sym === 'HASUI' || sym === 'AFSUI' || sym === 'CERT';
    };

    const allColStable = obligation.collaterals.length > 0 && obligation.collaterals.every(c => isStable(c.symbol));
    const allDebtStable = obligation.debts.length > 0 && obligation.debts.every(d => isStable(d.symbol));
    const isStableEmode = isNavi && allColStable && allDebtStable;

    const allColSui = obligation.collaterals.length > 0 && obligation.collaterals.every(c => isSuiLst(c.symbol));
    const allDebtSui = obligation.debts.length > 0 && obligation.debts.every(d => isSuiLst(d.symbol));
    const isSuiEmode = isNavi && allColSui && allDebtSui;

    // Recalculate collateral positions
    for (const col of obligation.collaterals) {
      const price = priceCache.getPriceUsd(col.coinType);
      const normAmount = Number(col.amount) / Math.pow(10, col.decimals);
      col.valueUsd = normAmount * price;

      totalCollateralUsd += col.valueUsd;
      const effectiveLt = isStableEmode ? 0.92 : isSuiEmode ? 0.93 : col.liquidationThreshold;
      liquidationThresholdCollateralUsd += col.valueUsd * effectiveLt;
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
    obligation.isLiquidatable = healthFactor < 1.0 && totalDebtUsd > 0.01 && totalCollateralUsd > 0;
    obligation.lastUpdatedMs = Date.now();

    return obligation;
  }

  /**
   * Find the most profitable liquidation pair (debt to repay vs collateral to seize)
   * Enforces protocol-specific close factor: 35% on NAVI per official docs, 50% on Scallop.
   */
  public static findBestLiquidationOpportunity(
    obligation: ObligationState,
    closeFactor?: number
  ): LiquidationOpportunity | null {
    if (!obligation.isLiquidatable || obligation.debts.length === 0 || obligation.collaterals.length === 0) {
      return null;
    }

    const effectiveCloseFactor = closeFactor ?? (
      obligation.protocol === 'navi' ? CONFIG.naviCloseFactor : CONFIG.liquidationCloseFactor
    );

    let bestOpportunity: LiquidationOpportunity | null = null;

    // Search across all debt and collateral combinations to find the highest-profit valid pair
    for (const targetDebt of obligation.debts) {
      for (const targetCollateral of obligation.collaterals) {
        // Check DEX route availability on Cetus, DeepBook, or Astros Aggregator
        const hasCetusRoute = CetusRouter.hasPool(targetCollateral.coinType, targetDebt.coinType);
        const hasDeepBookRoute = DeepBookRouter.hasPool(targetCollateral.coinType, targetDebt.coinType);
        const isSameAsset = targetCollateral.coinType.toLowerCase() === targetDebt.coinType.toLowerCase();

        // Determine best DEX (Astros Aggregator acts as universal multi-hop aggregator)
        let selectedDex: 'cetus' | 'deepbook' | 'astros' = 'cetus';
        if (CONFIG.preferredDex === 'deepbook' && hasDeepBookRoute) {
          selectedDex = 'deepbook';
        } else if (hasCetusRoute) {
          selectedDex = 'cetus';
        } else if (hasDeepBookRoute) {
          selectedDex = 'deepbook';
        } else {
          selectedDex = 'astros';
        }

        const debtPrice = priceCache.getPriceUsd(targetDebt.coinType);
        const colPrice = priceCache.getPriceUsd(targetCollateral.coinType);
        if (debtPrice <= 0 || colPrice <= 0) continue;

        // Compute maximum repayable debt based on protocol close factor (35% for NAVI, 50% for Scallop)
        const maxRepayAmount = (targetDebt.amount * BigInt(Math.floor(effectiveCloseFactor * 10000))) / 10000n;
        if (maxRepayAmount <= 0n) continue;

        // Liquidation bonus: dynamically resolve from NAVI pool registry (e.g. 10% for SUI, 8% for USDC) or coin config
        const naviPool = obligation.protocol === 'navi' ? naviProtocol.getPoolByCoinType(targetCollateral.coinType) : undefined;
        const colCfg = getCoinConfigByType(targetCollateral.coinType);
        const liquidationBonus = naviPool?.liquidationBonus ?? colCfg?.liquidationBonus ?? 0.05;

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
          // Apply a 0.9999 safety buffer to prevent MoveAbort 1606 (InsufficientCollateral)
          // due to off-chain vs on-chain oracle price mismatches or floating point inaccuracies.
          const matchedDebtUnits = Math.floor((matchedDebtUsd / debtPrice) * 0.9999 * Math.pow(10, targetDebt.decimals));
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
