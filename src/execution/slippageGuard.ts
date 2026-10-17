import { CONFIG } from '../config/index.js';
import { logger } from '../ui/logger.js';
import type {
  LiquidationOpportunity,
  SlippageCheckParams,
  SlippageCheckResult,
} from '../types/execution.js';

export class SlippageExceededError extends Error {
  public readonly minAmountOut: bigint;
  public readonly actualAmountOut?: bigint;
  public readonly slippageBps: number;
  public readonly maxSlippageBps: number;

  constructor(result: SlippageCheckResult) {
    super(
      result.reason ||
        `Slippage exceeded: expected slippage ${result.slippageBps} bps exceeds max ${result.maxSlippageBps} bps`
    );
    this.name = 'SlippageExceededError';
    this.minAmountOut = result.minAmountOut;
    this.actualAmountOut = result.actualAmountOut;
    this.slippageBps = result.slippageBps;
    this.maxSlippageBps = result.maxSlippageBps;
  }
}

/**
 * Pre-Broadcast Slippage Validation & Protection Engine
 *
 * Ensures all DEX swap legs and liquidation PTBs enforce strict bounded slippage
 * before any transaction is submitted to sequencer or RPC consensus.
 */
export class SlippageGuard {
  /**
   * Calculate exact minimum receive amount given expected output and max slippage bps.
   * e.g. expected = 1,000,000, maxSlippageBps = 100 (1%) -> minReceive = 990,000
   */
  public static calculateMinimumAmountOut(
    expectedAmountOut: bigint,
    maxSlippageBps: number = CONFIG.maxSlippageBps
  ): bigint {
    if (expectedAmountOut <= 0n) return 0n;
    if (maxSlippageBps < 0) maxSlippageBps = 0;
    if (maxSlippageBps > 10000) maxSlippageBps = 10000;

    const numerator = 10000n - BigInt(maxSlippageBps);
    return (expectedAmountOut * numerator) / 10000n;
  }

  /**
   * Validate that the actual or simulated amount out satisfies configured slippage bps
   */
  public static validateSlippage(
    expectedAmountOut: bigint,
    actualAmountOut: bigint,
    maxSlippageBps: number = CONFIG.maxSlippageBps
  ): SlippageCheckResult {
    const minAmountOut = this.calculateMinimumAmountOut(
      expectedAmountOut,
      maxSlippageBps
    );

    if (expectedAmountOut <= 0n) {
      return {
        isValid: false,
        minAmountOut: 0n,
        expectedAmountOut: 0n,
        actualAmountOut,
        slippageBps: 10000,
        maxSlippageBps,
        reason: 'Expected amount out must be greater than zero',
      };
    }

    if (actualAmountOut < minAmountOut) {
      const diff = expectedAmountOut - actualAmountOut;
      const slippageBps = Number((diff * 10000n) / expectedAmountOut);

      return {
        isValid: false,
        minAmountOut,
        expectedAmountOut,
        actualAmountOut,
        slippageBps,
        maxSlippageBps,
        reason: `Actual output ${actualAmountOut.toString()} is below minimum ${minAmountOut.toString()} (observed ${slippageBps} bps vs max allowed ${maxSlippageBps} bps)`,
      };
    }

    const diff =
      expectedAmountOut > actualAmountOut
        ? expectedAmountOut - actualAmountOut
        : 0n;
    const slippageBps = Number((diff * 10000n) / expectedAmountOut);

    return {
      isValid: true,
      minAmountOut,
      expectedAmountOut,
      actualAmountOut,
      slippageBps,
      maxSlippageBps,
    };
  }

  /**
   * Validate price divergence between DEX spot quote and Pyth oracle price benchmark
   */
  public static validatePriceDivergence(
    spotPrice: number,
    oraclePrice: number,
    maxSlippageBps: number = CONFIG.maxSlippageBps
  ): SlippageCheckResult {
    if (oraclePrice <= 0 || spotPrice <= 0) {
      return {
        isValid: false,
        minAmountOut: 0n,
        expectedAmountOut: 0n,
        slippageBps: 10000,
        maxSlippageBps,
        reason: 'Spot price and oracle price must be positive numbers',
      };
    }

    const priceDiff = Math.abs(spotPrice - oraclePrice);
    const divergenceBps = Math.round((priceDiff / oraclePrice) * 10000);
    const divergencePct = (priceDiff / oraclePrice) * 100;

    const isValid = divergenceBps <= maxSlippageBps;
    return {
      isValid,
      minAmountOut: 0n,
      expectedAmountOut: 0n,
      slippageBps: divergenceBps,
      maxSlippageBps,
      priceDivergencePct: divergencePct,
      reason: isValid
        ? undefined
        : `DEX spot price ($${spotPrice.toFixed(4)}) diverges from Pyth oracle ($${oraclePrice.toFixed(4)}) by ${divergenceBps} bps, exceeding max allowed ${maxSlippageBps} bps`,
    };
  }

  /**
   * Validate a liquidation opportunity's financial economics before building or broadcasting PTB
   */
  public static validateOpportunity(
    opportunity: LiquidationOpportunity,
    maxSlippageBps: number = CONFIG.maxSlippageBps
  ): SlippageCheckResult {
    const debtRepayUsd = opportunity.debtRepayUsd;
    const colReceiveUsd = opportunity.collateralReceiveUsd;

    if (debtRepayUsd <= 0 || colReceiveUsd <= 0) {
      return {
        isValid: false,
        minAmountOut: 0n,
        expectedAmountOut: 0n,
        slippageBps: 10000,
        maxSlippageBps,
        reason: 'Liquidation opportunity has invalid zero or negative financial value',
      };
    }

    // Expected yield without bonus should be >= 1.0 (collateral USD > debt USD)
    if (colReceiveUsd < debtRepayUsd) {
      return {
        isValid: false,
        minAmountOut: 0n,
        expectedAmountOut: 0n,
        slippageBps: 10000,
        maxSlippageBps,
        reason: `Collateral received ($${colReceiveUsd.toFixed(2)}) is less than debt repay requirement ($${debtRepayUsd.toFixed(2)})`,
      };
    }

    return {
      isValid: true,
      minAmountOut: 0n,
      expectedAmountOut: 0n,
      slippageBps: 0,
      maxSlippageBps,
    };
  }

  /**
   * Strict pre-broadcast assertion that throws SlippageExceededError if slippage is violated.
   * Guaranteed to abort execution before gas is spent.
   */
  public static enforce(params: SlippageCheckParams): void {
    if (params.actualAmountOut !== undefined) {
      const result = this.validateSlippage(
        params.expectedAmountOut,
        params.actualAmountOut,
        params.maxSlippageBps
      );
      if (!result.isValid) {
        logger.error({ result }, '❌ Slippage Guard Violation: Aborting broadcast');
        throw new SlippageExceededError(result);
      }
    }

    if (params.spotPrice !== undefined && params.oraclePrice !== undefined) {
      const result = this.validatePriceDivergence(
        params.spotPrice,
        params.oraclePrice,
        params.maxSlippageBps
      );
      if (!result.isValid) {
        logger.error({ result }, '❌ Price Divergence Violation: Aborting broadcast');
        throw new SlippageExceededError(result);
      }
    }
  }
}

export const slippageGuard = SlippageGuard;
