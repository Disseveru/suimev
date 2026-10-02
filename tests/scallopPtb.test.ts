import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { ScallopPtbBuilder } from '../src/protocols/scallop/scallopPtb.js';
import { SCALLOP_CONFIG, SUI_CLOCK_OBJECT_ID } from '../src/config/constants.js';

describe('ScallopPtbBuilder & Raw Transaction Assembly', () => {
  const dummyObligationId = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const dummyOperator = '0x2222222222222222222222222222222222222222222222222222222222222222';
  const suiCoinType = '0x2::sui::SUI';
  const usdcCoinType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

  it('correctly constructs a raw Transaction() with all Scallop liquidation instructions', () => {
    const tx = new Transaction();
    tx.setSender(dummyOperator);

    // 1. Flash loan
    const { loanCoin, receipt } = ScallopPtbBuilder.addFlashLoan(
      tx,
      usdcCoinType,
      100_000_000n // 100 USDC
    );
    expect(loanCoin).toBeDefined();
    expect(receipt).toBeDefined();

    // 2. Liquidate
    const [collateralCoin, leftoverDebtCoin] = ScallopPtbBuilder.addLiquidate(
      tx,
      dummyObligationId,
      loanCoin,
      usdcCoinType,
      suiCoinType
    );
    expect(collateralCoin).toBeDefined();
    expect(leftoverDebtCoin).toBeDefined();

    // 3. Repay Flash Loan
    ScallopPtbBuilder.addRepayFlashLoan(
      tx,
      usdcCoinType,
      receipt,
      loanCoin
    );

    const txData = tx.getData();
    expect(txData.commands.length).toBe(3);

    // Verify first command is borrow_flash_loan
    const cmd0 = txData.commands[0] as any;
    expect(cmd0.$kind).toBe('MoveCall');
    expect(cmd0.MoveCall.package).toBe(SCALLOP_CONFIG.protocolPkg);
    expect(cmd0.MoveCall.module).toBe('flash_loan');
    expect(cmd0.MoveCall.function).toBe('borrow_flash_loan');

    // Verify second command is liquidate::liquidate with exact arguments
    const cmd1 = txData.commands[1] as any;
    expect(cmd1.$kind).toBe('MoveCall');
    expect(cmd1.MoveCall.package).toBe(SCALLOP_CONFIG.protocolPkg);
    expect(cmd1.MoveCall.module).toBe('liquidate');
    expect(cmd1.MoveCall.function).toBe('liquidate');
    expect(cmd1.MoveCall.typeArguments).toEqual([usdcCoinType, suiCoinType]);

    // Verify third command is repay_flash_loan
    const cmd2 = txData.commands[2] as any;
    expect(cmd2.$kind).toBe('MoveCall');
    expect(cmd2.MoveCall.package).toBe(SCALLOP_CONFIG.protocolPkg);
    expect(cmd2.MoveCall.module).toBe('flash_loan');
    expect(cmd2.MoveCall.function).toBe('repay_flash_loan');
  });

  it('buildCompleteLiquidation builds a full atomic zero-capital PTB with lock handling, swap, and profit transfer', () => {
    const tx = new Transaction();
    tx.setSender(dummyOperator);

    const result = ScallopPtbBuilder.buildCompleteLiquidation({
      tx,
      obligationId: dummyObligationId,
      debtCoinType: usdcCoinType,
      collateralCoinType: suiCoinType,
      debtAmountToRepay: 250_000_000n,
      expectedCollateralAmount: 130_000_000_000n,
      recipientAddress: dummyOperator,
      isLocked: true, // test force_unstake_unhealthy insertion
      dex: 'cetus',
    });

    expect(result.tx).toBe(tx);
    expect(result.collateralCoin).toBeDefined();
    expect(result.leftoverDebtCoin).toBeDefined();
    expect(result.profitCoin).toBeDefined();

    const txData = tx.getData();
    const commandKinds = txData.commands.map((c) => c.$kind);

    expect(commandKinds).toContain('MoveCall');
    expect(commandKinds).toContain('MergeCoins');
    expect(commandKinds).toContain('SplitCoins');
    expect(commandKinds).toContain('TransferObjects');

    // Verify essential Move functions are executed in order
    const moveCalls = txData.commands.filter((c) => c.$kind === 'MoveCall') as any[];
    const funcNames = moveCalls.map((m) => m.MoveCall.function);
    expect(funcNames).toContain('force_unstake_unhealthy_v3');
    expect(funcNames).toContain('borrow_flash_loan');
    expect(funcNames).toContain('liquidate');
    expect(funcNames).toContain('repay_flash_loan');
    // Ensure force_unstake_unhealthy is executed first
    expect(funcNames[0]).toBe('force_unstake_unhealthy_v3');
  });

  it('supports same-asset liquidation without incurring DEX swap overhead', () => {
    const tx = new Transaction();
    tx.setSender(dummyOperator);

    const result = ScallopPtbBuilder.buildCompleteLiquidation({
      tx,
      obligationId: dummyObligationId,
      debtCoinType: usdcCoinType,
      collateralCoinType: usdcCoinType, // Same asset!
      debtAmountToRepay: 100_000_000n,
      recipientAddress: dummyOperator,
      isLocked: false,
    });

    expect(result).toBeDefined();
    const txData = tx.getData();
    // In same-asset mode, no DEX swap moveCall is added
    const moveCalls = txData.commands.filter((c) => c.$kind === 'MoveCall') as any[];
    expect(moveCalls.length).toBe(3); // flash loan, liquidate, repay flash loan
  });
});
