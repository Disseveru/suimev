# Project Rules & Operating Standards: suimev & evm-mev

## 1. Absolute Transparency & Zero Deceit (CRITICAL NON-NEGOTIABLE LAW)

- **NEVER BE DECEITFUL OR LIE TO THE USER**: Under NO circumstances should an agent ever lie, exaggerate, fabricate numbers, or omit failures to appear successful or to prematurely satisfy a task.
- **NEVER FALSELY DECLARE SUCCESS**: If an on-chain transaction failed, if a simulation reverted, or if an obligation was unexecutable, report the exact raw error, the digest, and the reality. Never make the user believe an outcome was successful when it is not.
- **NEVER SILENTLY INSERT PLACEHOLDER KEYS OR MOCK VALUES**: Never insert dummy keys (`0x000...001`), mock responses, or dummy contract addresses to fake progress.
- **MANDATORY DISCLOSURE**: If a feature, command, or script requires a real secret, private key, funded wallet, or deployed on-chain smart contract, you **MUST explicitly tell the user upfront**:
  1. What exact environment variable or file needs to be updated.
  2. What format is required.
  3. Where to obtain or generate it safely.
  4. What will fail or remain unexecutable if it is missing.
- **Fail Fast with Transparent Truth**: Always disclose current wallet balances, gas costs, failed attempts, and exact simulation reverts without sugarcoating.

## 2. Online Research & Verification Protocol

- **Use `/browser` ONLY for Official Protocol Documentation & Legitimate Sources**: When conducting online verification, consult only official protocol repositories (e.g. Scallop, NAVI, Cetus, DeepBook, MystenLabs), official developer docs, verified explorer data (Suiscan/SuiVision), and verified on-chain bytecode. Never rely on unverified forum claims or guesswork.

## 3. Rigorous Protocol Fact-Checking & Official Sources

- All contract addresses, pool IDs, package IDs, function signatures, and ABI interfaces must be verified against official protocol GitHub repositories, official documentation, and live on-chain bytecode.
- Never guess or approximate contract addresses or Move type parameters.

## 3. Atomic Capital Preservation

- Every liquidation PTB (Sui) or smart contract call (EVM) must enforce strict profit invariants (`minProfit` checks) before repayment.
- Undercollateralized accounts with bad debt or insufficient collateral to cover repayment must be rejected before submitting to consensus.

## 4. Collection Iteration Safety (Map/Set Mutation Guard)

- **NEVER** mutate a `Map` or `Set` (`.set()`, `.delete()`, `.add()`) directly inside a `for (... of map.entries())` or `for (... of set)` loop.
- In ECMAScript, deleting and re-inserting an entry during iteration causes the iterator to visit it again at the end, leading to an infinite event loop that hangs the engine at 100% CPU.
- **MANDATORY**: Always snapshot collections into an immutable array before iterating: `const entries = Array.from(collection.entries());`.

## 5. Zero-Capital Solvency & Bad Debt Guard

- An obligation is only eligible for zero-capital liquidation if:
  `healthFactor < 1.00 && totalDebtUsd > 0.01 && totalCollateralUsd > 0 && collaterals.length > 0`
- Historical bad debt ($0 collateral) can never be liquidated via flash loan because zero collateral can be seized to repay the borrowed principal. The engine must skip these positions immediately without entering execution queues.

## 6. Cetus CLMM Atomic Flash Swap Invariants

- For high-liquidity Sui pairs, Cetus CLMM `pool::flash_swap` provides superior liquidity compared to protocol-internal flash loans.
- When assembling atomic flash swap liquidations, the exact borrower position limits and close factor must be checked before building balance splits to prevent Move abort code 2 on over-repayment.

## 7. Scallop Protocol On-Chain Oracle Invariants

- **Native Pyth Update Over Sponsorship**:
  - Never set `{ isSponsoredTx: true }` when calling Scallop's `updateAssetPricesQuick()`.
  - The sponsored gas station package (`0xa6f9bec2...::pyth_sponsor`) reverts on mainnet with `CommandArgumentError { arg_idx: 0, kind: TypeMismatch }`.
  - Always set `{ isSponsoredTx: false }` to pay the 1-MIST update fee natively via GasCoin split.

- **Whole-Obligation Oracle Refresh (Abort 1025 Guard)**:
  - Scallop's on-chain liquidation contracts (`liquidate` and `force_unstake_unhealthy_v3`) evaluate the total portfolio value using `de5c...::price::get_price` across **EVERY collateral and debt asset** held by the borrower.
  - If even one asset has an expired or un-updated oracle feed, the Move call aborts with error `1025` (`STALE_PRICE`).
  - Every liquidation PTB MUST prepend Pyth + x_oracle price updates for the complete set of assets in `obligation.collaterals` and `obligation.debts`.

## 8. On-Chain Health & Risk Level Ground Truth (Abort 2 Guard)

- **Protocol-Calculated Risk Level**:
  - Off-chain price caches can misprice multi-representation tokens (e.g. Wormhole WBTC vs Sui Bridge WBTC vs Native WBTC, WETH).
  - On Scallop, an obligation is only in default if `totalRiskLevel >= 1.0` (or `totalUnhealthyCollateralValue > 0`) as calculated by `query.getObligationAccountById()`.
  - Calling `force_unstake_unhealthy_v3` on an obligation with `riskLevel < 1.0` aborts with error `2` (`obligation_is_healthy`). The engine must verify `riskLevel >= 1.0` before constructing liquidation PTBs.

## 9. Sui Move Type & Resource Preservation

- When chaining zero-capital flash loans, always match exact type arguments (`Balance<T>` vs `Coin<T>`).
- Any transient `Balance<T>` created via `coin::into_balance` lacks the `drop` ability and must be explicitly consumed (e.g., via `repay_flash_loan` or `coin::from_balance`) within the same PTB to avoid transaction construction failures.

