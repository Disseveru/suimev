import { privateKeyToAccount } from 'viem/accounts';
import { CONFIG } from '../config/index.js';
import { evmClient } from '../client/evmClient.js';
import { EvmLiquidationOpportunity } from '../oracles/healthFactor.js';
import { EvmTxBuilder } from './txBuilder.js';

export interface EvmExecutionResult {
  hash: `0x${string}`;
  success: boolean;
  gasUsed: bigint;
  netProfitUsd: number;
  errorMessage?: string;
}

export class EvmExecutor {
  /**
   * Check operator wallet native balance for gas
   */
  public static async checkBalance(): Promise<{ address: `0x${string}`; balanceWei: bigint; balanceNative: number }> {
    if (!CONFIG.privateKey) {
      throw new Error(
        'EVM_PRIVATE_KEY is not set in evm-mev/.env. You must provide a valid 64-char hex private key starting with 0x to query wallet or execute transactions.'
      );
    }
    const account = privateKeyToAccount(CONFIG.privateKey);
    const balanceWei = await evmClient.getBalance({ address: account.address });
    const balanceNative = Number(balanceWei) / 1e18;
    return {
      address: account.address,
      balanceWei,
      balanceNative,
    };
  }

  /**
   * Pre-flight simulation using eth_call against live node state
   */
  public static async simulateCall(
    opportunity: EvmLiquidationOpportunity,
    lendingPool: `0x${string}`
  ): Promise<{ success: boolean; error?: string }> {
    if (!CONFIG.privateKey) {
      throw new Error('EVM_PRIVATE_KEY is not set in evm-mev/.env');
    }
    const account = privateKeyToAccount(CONFIG.privateKey);
    const tx = EvmTxBuilder.buildLiquidationCalldata(opportunity, lendingPool);

    try {
      await evmClient.call({
        account: account.address,
        to: tx.to,
        data: tx.data,
      });
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: err.shortMessage || err.message || String(err),
      };
    }
  }

  /**
   * Live broadcast to EVM consensus
   */
  public static async execute(
    opportunity: EvmLiquidationOpportunity,
    lendingPool: `0x${string}`
  ): Promise<EvmExecutionResult> {
    if (!CONFIG.privateKey) {
      throw new Error('EVM_PRIVATE_KEY is not set in evm-mev/.env');
    }
    const account = privateKeyToAccount(CONFIG.privateKey);
    const balance = await evmClient.getBalance({ address: account.address });

    if (balance === 0n) {
      throw new Error(`Operator wallet ${account.address} has 0.00 native tokens. A small gas reserve is required for live broadcast.`);
    }

    if (CONFIG.flashLiquidatorAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('FLASH_LIQUIDATOR_ADDRESS is not set. Deploy FlashLiquidator.sol to Sei/Monad before live execution.');
    }

    const tx = EvmTxBuilder.buildLiquidationCalldata(opportunity, lendingPool);
    const gasPrice = await evmClient.getGasPrice();
    const priorityFee = EvmTxBuilder.calculatePriorityFee(gasPrice, opportunity.expectedGrossProfitUsd);

    // Prepare live wallet client
    const { createWalletClient, http } = await import('viem');
    const walletClient = createWalletClient({
      account,
      chain: {
        id: CONFIG.chainConfig.id,
        name: CONFIG.chainConfig.name,
        nativeCurrency: CONFIG.chainConfig.nativeCurrency,
        rpcUrls: { default: { http: CONFIG.chainConfig.rpcUrls } },
      },
      transport: http(CONFIG.chainConfig.rpcUrls[0]),
    });

    const hash = await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      maxPriorityFeePerGas: priorityFee,
      maxFeePerGas: gasPrice + priorityFee,
    });

    const receipt = await evmClient.waitForTransactionReceipt({ hash });
    const isSuccess = receipt.status === 'success';

    return {
      hash,
      success: isSuccess,
      gasUsed: receipt.gasUsed,
      netProfitUsd: isSuccess ? opportunity.netProfitUsd : 0,
    };
  }
}
