import { encodeFunctionData, parseAbi } from 'viem';
import { CONFIG } from '../config/index.js';
import { EvmLiquidationOpportunity } from '../oracles/healthFactor.js';

export const FLASH_LIQUIDATOR_ABI = parseAbi([
  'function executeViaBalancer((address lendingPool, address borrower, address debtAsset, address collateralAsset, uint256 debtToCover, uint24 swapPoolFee, uint256 minProfit) params) external',
  'function executeViaAave((address lendingPool, address borrower, address debtAsset, address collateralAsset, uint256 debtToCover, uint24 swapPoolFee, uint256 minProfit) params) external',
]);

export class EvmTxBuilder {
  /**
   * Build transaction calldata for the on-chain FlashLiquidator contract
   */
  public static buildLiquidationCalldata(
    opportunity: EvmLiquidationOpportunity,
    lendingPoolAddress: `0x${string}`,
    swapFeeTier: number = 3000, // 0.3% Uniswap pool fee
    useBalancer: boolean = true
  ): { to: `0x${string}`; data: `0x${string}` } {
    const minProfitRaw = BigInt(Math.floor(CONFIG.minProfitUsd * 1e6)); // in debt decimals (e.g. USDC 6 dec)

    const params = {
      lendingPool: lendingPoolAddress,
      borrower: opportunity.borrower,
      debtAsset: opportunity.debtAsset,
      collateralAsset: opportunity.collateralAsset,
      debtToCover: opportunity.debtAmountToRepay,
      swapPoolFee: swapFeeTier,
      minProfit: minProfitRaw,
    };

    const functionName = useBalancer ? 'executeViaBalancer' : 'executeViaAave';

    const data = encodeFunctionData({
      abi: FLASH_LIQUIDATOR_ABI,
      functionName,
      args: [params],
    });

    return {
      to: CONFIG.flashLiquidatorAddress || '0x0000000000000000000000000000000000000000',
      data,
    };
  }

  /**
   * Calculate EIP-1559 Dynamic Priority Gas Tip (PGA) to ensure priority validator ordering
   */
  public static calculatePriorityFee(baseFee: bigint, expectedProfitUsd: number): bigint {
    const profitShare = 0.20; // Offer 20% of net profit as tip
    const gasUnits = 350000n; // Typical flash liquidation uses ~350k EVM gas units

    // Convert profit in USD to approximate native wei (assuming native asset ~$1.00)
    const profitTipWei = BigInt(Math.floor(expectedProfitUsd * profitShare * 1e18));
    const tipPerGasWei = profitTipWei / gasUnits;

    const minTipWei = BigInt(Math.floor(CONFIG.priorityFeeGwei * 1e9));
    return tipPerGasWei > minTipWei ? tipPerGasWei : minTipWei;
  }
}
