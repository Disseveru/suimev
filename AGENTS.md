# Project Rules & Operating Standards: suimev & evm-mev

**This is production MEV infrastructure for Sui and parallel EVM networks. It is not entertainment, role-play, or experimental software. Treat every change as potentially deployable code with real consequences.**

---

## 1. Absolute Transparency & Zero Deceit (CRITICAL NON-NEGOTIABLE LAW)

### 1.1 No Fabrication, Exaggeration, or Omission

- **NEVER lie, exaggerate performance, or fabricate transaction results.** Under NO circumstances should an agent invent transaction digests, simulate fake profitability, claim successful executions without evidence, or omit failures to appear on schedule.
- **NEVER falsely declare success**: If an on-chain transaction failed, if a simulation reverted, if an integration is incomplete, or if a feature is unverified, report the exact raw error, abort code, digests, and blockers.
- **NEVER silently insert placeholder keys, mock values, or dummy addresses** to fake progress:
  - No dummy private keys (`0x000...001` or generic test patterns).
  - No fake RPC responses masquerading as live state.
  - No placeholder pool IDs, package IDs, or oracle feeds.
  - No hardcoded test wallets in production code paths.
  - No mock liquidation results presented as real simulation output.

### 1.2 Mandatory Upfront Disclosure

If a feature, script, integration, or command requires any of the following, **MUST explicitly tell the user before describing the feature as runnable**:

1. A real private key, funded wallet, or operator account.
2. An RPC provider credential (API key, endpoint whitelist).
3. A deployed on-chain smart contract, package, or bridge.
4. Configured environment variables or `.env` secrets.
5. Protocol permissions (Scallop debt origination, Cetus pool access, oracle feed sponsorships).
6. Real network gas or protocol fees.

For each, document:
- Exact environment variable or configuration file name and format.
- Safe source to obtain or generate it (e.g., "generate a new Sui keypair via `sui client new-address ed25519`").
- What will fail or remain unexecutable if it is missing.
- Whether the feature is dry-run-only or requires live approval.

**Example disclose:** "This liquidation feature requires `SUI_PRIVATE_KEY` (bech32 format `suiprivkey1...`), at least 0.5 SUI in gas, a live Alchemy Sui Mainnet RPC endpoint, and human operator approval to execute on mainnet. Without these, the feature will only simulate."

### 1.3 Fail Fast with Transparent Truth

- Always report current wallet balances, gas costs, RPC latency, and simulation state without sugarcoating.
- Disclose failed simulation results, reverts, abort codes, and exact error messages.
- Log transaction digests, checkpoint numbers, and state versions for all executed transactions.
- Never hide a failure behind a vague message like "unable to execute." Provide the exact Move abort code, Pyth error, or RPC response.

---

## 2. Code-Review & Execution Discipline

### 2.1 Pre-Submission Verification Checklist

Before any agent change is considered ready for code review or merge:

- [ ] **Source verified against protocol documentation**: All package IDs, object IDs, Move function signatures, ABI interfaces, pool IDs, oracle feeds, and market references are confirmed from official GitHub repositories, live on-chain state, or typed SDKs (not guessed or copied from unverified sources).
- [ ] **Dry-run tested locally**: Run `npm test`, `npm run simulate`, and at minimum one manual CLI invocation on testnet/devnet with a small stake or --dry-run flag. Document the command and full output.
- [ ] **Simulation passes with real or testnet data**: A pre-flight `devInspectTransactionBlock` or `eth_call` has been executed against current chain state. If it failed, document the abort code and required fix.
- [ ] **No placeholder credentials or mock wallets in source**: Private keys, RPC endpoints, operator addresses, and pool IDs appear only in `.env.example` or behind explicit env-var guards. Never commit real secrets or test wallets.
- [ ] **Capital and repayment invariants are enforced**: `minProfit`, `maxSlippage`, `healthFactor < 1.0`, collateral checks, oracle freshness, and gas cost calculations are all present and tested.
- [ ] **Collection iteration is safe**: No `Map` or `Set` mutations inside iteration. All collection-based loops snapshot to `Array` first.
- [ ] **Sui Move resources are preserved**: `Balance<T>` and `Coin<T>` are correctly consumed or stored; no resource leaks across PTB calls.
- [ ] **Secrets are never logged**: No full private keys, signed transactions, wallet seeds, or RPC credentials in logs or error messages.
- [ ] **Test coverage includes failure paths**: At least one test exercises slippage reversion, stale prices, bad debt rejection, insufficient liquidity, and failed oracle updates.

### 2.2 Pull Request Communication

Every PR description must include:

1. **What changed and why:** Clear statement of the feature, fix, or optimization. Link to any related issues.
2. **Type of change:** "New liquidation integration," "Bug fix: Scallop oracle caching," "Performance: PTB assembly optimization," etc.
3. **Verification evidence:**
   - Exact CLI commands run locally (e.g., `npm run simulate`, `npm test -- MyFeature.test.ts`).
   - Full test output or simulation summary (abort codes, gas used, profit calculated, digests if applicable).
   - If on-chain, the transaction digest, checkpoint, and state version.
4. **Known limitations and blockers:**
   - "This feature is dry-run only; live execution requires operator approval in config."
   - "Oracle feeds for USDC are stale on testnet; feature tested against mainnet data only."
   - "Cetus CLMM flash swaps require minimum 100k DEEP in pool liquidity; not available on all pairs."
5. **Safety assessment:**
   - Dry-run only, or ready for live (with conditions).
   - New environment variables or credentials required.
   - Backward compatibility with existing liquidations.
   - Impact on existing test suite (all pass, new tests added, etc.).

### 2.3 Code Review Requirements

Reviewers **MUST** reject any PR that:

- Claims a feature is complete without simulation or test results.
- Merges placeholder credentials, dummy addresses, or mock data into a live path.
- Removes or weakens `minProfit`, `maxSlippage`, health-factor, or slippage-protection checks.
- Mutates collections during iteration without snapshotting.
- Logs secrets, full transactions, or sensitive wallet data.
- Skips oracle freshness or protocol-state validation checks.
- Adds production code paths that are not covered by at least a dry-run test.

---

## 3. Rigorous Protocol Fact-Checking & Official Sources

### 3.1 Authority Hierarchy (in order of trustworthiness)

1. **Official protocol GitHub repositories** and typed TypeScript SDKs.
2. **Live on-chain data**: Queried directly via RPC (package inspection, pool state, oracle feeds, market configuration).
3. **Official documentation websites** (Scallop docs, NAVI docs, Cetus docs).
4. **Community forums or Discord** (for informal discussion only; never as a source of truth for addresses or ABIs).
5. **Never** guess, approximate, or infer addresses and type parameters.

### 3.2 Verification Workflows

For every protocol address or type parameter:

- Search the official GitHub repo for the exact package ID or object ID.
- Confirm it matches the current mainnet deployment (use `sui client call ... --json` or RPC `getObject` if needed).
- Document the source (e.g., "Scallop `core` package ID confirmed from https://github.com/scallop-io/scallop/releases").
- If a pool or market is new or non-standard, query its on-chain state to confirm liquidity, fee tier, and asset composition.

### 3.3 Multi-Representation Token Handling

- Be aware of Wormhole-bridged tokens (e.g., Wormhole WBTC, WETH, USDC) vs. native Sui representations.
- Prices for the same token on different bridges can diverge significantly.
- Oracle feeds may not cover all representations equally.
- When liquidating, confirm the borrower's collateral and debt are priced against the same oracle feed and market representation.

---

## 4. Atomic Capital Preservation

### 4.1 Profit Invariant (Mandatory)

Every liquidation PTB (Sui) or smart contract call (EVM) **MUST** enforce:

```
Net Profit = Gross Profit - GasCost - FlashLoanFees - ProtocolFees - DEXFees - Slippage
Net Profit >= MIN_PROFIT_USD (default: $5.00)
```

- Calculate **gross profit** as (seizedCollateralUSD - debtRepaidUSD).
- Deduct **all fees**: Pyth update fees, flash loan percentage, protocol liquidation bonus, DEX swap slippage, and compute/storage gas.
- Verify profit in USD using the oracle price at the time of simulation.
- **Never** submit a transaction if simulated net profit < `MIN_PROFIT_USD`.

### 4.2 Undercollateralized & Bad Debt Guard

- Positions with `totalCollateralUSD <= 0` or missing collateral assets are historical bad debt; skip immediately.
- Positions with `healthFactor >= 1.0` are healthy; skip.
- Positions with `totalDebtUSD < 0.01` are dust; skip (not worth liquidation cost).
- Positions with insufficient liquidity to close the required debt fraction are unexecutable; skip and report.

### 4.3 Repayment Invariants (Before Broadcasting)

Before broadcasting a liquidation PTB or EVM call:

- Confirm the oracle prices used for valuation are fresh (not older than 10 seconds for Pyth, protocol-specific for others).
- Confirm the DEX liquidity and slippage estimate are still valid (simulate immediately before submission).
- Confirm the operator wallet has sufficient gas (for Sui: at least 2x the estimated gas in the sender's primary gas object).
- Confirm the repayment coin or balance has sufficient amount to cover debt + fees + rounding.

---

## 5. Collection Iteration Safety (Map/Set Mutation Guard)

### 5.1 The Hazard

In ECMAScript, mutating a `Map` or `Set` (`.set()`, `.delete()`, `.add()`, `.clear()`) directly inside a `for (... of map.entries())`, `for (... of set)`, or `.forEach()` loop:

- Causes the iterator to revisit inserted entries at the end of the loop.
- Results in an infinite loop that hangs the engine at 100% CPU.
- Is nearly impossible to detect without strict testing.

### 5.2 Mandatory Pattern

**Always snapshot collections into an immutable array before iterating:**

```typescript
// ❌ NEVER do this:
for (const [key, value] of obligationMap.entries()) {
  if (shouldLiquidate(value)) {
    obligationMap.delete(key); // INFINITE LOOP HAZARD
  }
}

// ✅ ALWAYS do this:
const entries = Array.from(obligationMap.entries());
const toDelete = [];
for (const [key, value] of entries) {
  if (shouldLiquidate(value)) {
    toDelete.push(key);
  }
}
toDelete.forEach(key => obligationMap.delete(key));
```

**Code review:** Every collection-based loop must be inspected for this pattern. Add a comment marker:

```typescript
// SNAPSHOT: safe to mutate after loop
const entries = Array.from(mySet);
```

---

## 6. Zero-Capital Solvency & Bad Debt Guard

### 6.1 Eligibility Check

An obligation is **only eligible** for zero-capital liquidation if **all** of the following are true:

```
healthFactor < 1.00
AND totalDebtUSD > 0.01
AND totalCollateralUSD > 0
AND collaterals.length > 0
AND collateralAssets are not stale/missing prices
```

### 6.2 Historical Bad Debt (Zero Collateral)

- Positions with `totalCollateralUSD <= 0` have zero collateral and zero seizable assets.
- A flash loan cannot repay debt if there is no collateral to liquidate and sell.
- These positions are **skipped immediately**; do not attempt liquidation.
- Log and report as "bad debt: skip" with the obligation ID.

### 6.3 Dust Filtering

- Obligations with total debt < $0.01 or < 100 MIST of any single asset are too small to justify gas costs.
- Skip these positions unless `MIN_PROFIT_USD` is set to a very low value (not recommended).

---

## 7. Cetus CLMM Atomic Flash Swap Invariants

### 7.1 Liquidity & Close Factor

For high-liquidity Sui pairs, Cetus CLMM's `pool::flash_swap` provides superior liquidity compared to protocol-internal flash loans.

### 7.2 Collateral Position Limits

- When assembling an atomic liquidation with a flash swap, check the **exact collateral position limit** on the borrower's account (close factor per asset).
- Close factors often differ per asset and per protocol (Scallop vs. NAVI).
- Liquidating more than the close factor (e.g., attempting to liquidate 60% when close factor is 50%) causes a Move abort code 2 (`ECF_TRANSFER_OVERFLOW` or similar).

### 7.3 Balance Split & Slippage

- When swapping collateral back to debt via Cetus, specify a strict `minAmountOut` based on the current pool tick and fee.
- If the swap receives less than `minAmountOut`, the entire PTB reverts (correct behavior).
- Never set `minAmountOut = 0` or to an unrealistic minimum to force a swap through.

---

## 8. Scallop Protocol On-Chain Oracle Invariants

### 8.1 Native Pyth Update Over Sponsorship

- **Never** set `{ isSponsoredTx: true }` when calling Scallop's `updateAssetPricesQuick()` or related functions on **mainnet**.
- The Scallop sponsored gas station package reverts on mainnet with `CommandArgumentError { arg_idx: 0, kind: TypeMismatch }`.
- **Always** set `{ isSponsoredTx: false }` to pay the 1-MIST update fee natively via gas coin split.

### 8.2 Whole-Obligation Oracle Refresh (Abort 1025 Guard)

- Scallop's on-chain liquidation calls (`liquidate`, `repay`, `borrow`, `force_unstake_unhealthy_v3`) evaluate portfolio value using `x_oracle::price::get_price()` across **EVERY collateral and debt asset**.
- If **even one asset** has an expired or un-updated oracle feed, the Move call aborts with error `1025` (`STALE_PRICE`).
- **Every liquidation PTB MUST prepend oracle price updates** for the complete set of assets in `obligation.collaterals` and `obligation.debts`.

### 8.3 Oracle Update Strategy

- Query Pyth prices via Hermes API (`price_feed_ids` for each asset).
- Call `updateAssetPricesQuick()` with the complete Pyth price update bytes for all collateral and debt assets.
- Verify the result with a `getObligationAccountById()` query to confirm the prices are fresh.

---

## 9. On-Chain Health & Risk Level Ground Truth (Abort 2 Guard)

### 9.1 Protocol-Calculated Risk Level

- Off-chain price caches can misprice multi-representation tokens (Wormhole WBTC vs. Sui Bridge WBTC, WETH, USDC).
- On Scallop, an obligation is **only in liquidatable default** if:
  - `totalRiskLevel >= 1.0` (as calculated by `query.getObligationAccountById()` on-chain), OR
  - `totalUnhealthyCollateralValue > 0` (protocol-specific calculation).
- A local off-chain health factor of `< 1.0` is **necessary but not sufficient**; the protocol's on-chain calculation is authoritative.

### 9.2 Abort 2 Guard (Obligation Is Healthy)

- Calling `force_unstake_unhealthy_v3` on an obligation with on-chain `riskLevel < 1.0` aborts with Move error `2` (`obligation_is_healthy`).
- **Before constructing a liquidation PTB:**
  1. Query the obligation's current on-chain state (`getObligationAccountById()`).
  2. Verify `riskLevel >= 1.0` or `unhealthyCollateral > 0`.
  3. Simulate the liquidation call to confirm no abort 2.

### 9.3 On-Chain Price Ground Truth

- Always re-check on-chain prices immediately before simulation, especially for stale oracles.
- If a price is more than 10 seconds old in Pyth or more than the protocol's configured staleness threshold, refresh it before simulating.

---

## 10. Sui Move Type & Resource Preservation

### 10.1 Type Argument Matching

- When chaining zero-capital flash loans, ensure exact type argument matching across all calls.
- `Balance<T>` ≠ `Coin<T>`; they have different ability constraints.
- Protocol SDKs often have type signatures that enforce matching; verify in the TypeScript types and Move ABIs.

### 10.2 Transient Balance Resource Management

- A `Balance<T>` created via `coin::into_balance(coin)` **lacks the `drop` ability** and must be explicitly consumed within the same PTB.
- Valid consumption methods: `repay_flash_loan()`, `coin::from_balance()`, or direct deposit into a protocol vault.
- If a `Balance<T>` is not consumed or stored in a Move struct, the PTB aborts with a `dropmiss` error.

### 10.3 Zero-Capital PTB Construction

- In a single PTB, it is legal to hold multiple transient resources as long as each is eventually consumed.
- Example: `Balance<USDC>` (from flash loan) → `Coin<USDC>` (via `from_balance`) → repay debt, seize collateral, swap collateral, split, and transfer.
- Every intermediate resource must have a clear ownership and consumption path.

---

## 11. Fast Presign & Gas Object Caching

### 11.1 Network Latency Cost

In low-latency Sui PTB execution, querying gas objects via `client.getCoins()` immediately before signing introduces **150–300 ms network round-trip delay**.

### 11.2 Gas Object Pre-Caching Strategy

- Pre-cache operator gas coin object references (`objectId`, `version`, `digest`) in memory at startup.
- Construct offline transaction blocks using `Transaction.from()` or `.build({ ... })` for **sub-10 ms signing and submission**.
- Monitor for gas object mutations: immediately after any consensus broadcast or coin split, refresh the cache.

### 11.3 Cache Invalidation

- After a PTB that splits or transfers gas, query the updated gas coin state and refresh the cache entry.
- Periodically validate the cache (every 10–30 seconds) to catch stale versions or digests.
- If a PTB fails due to a stale gas version, immediately invalidate and refresh the cache.

---

## 12. Dedicated RPC Routing & Failover Protocol

### 12.1 Deprecated Public Endpoints

- **MystenLabs deprecated the legacy public Sui JSON-RPC** at `fullnode.mainnet.sui.io:443`.
- All production queries and PTB submissions must route through **high-availability dedicated RPCs**:
  - Alchemy Sui Mainnet (primary).
  - NodeInfra or Sui RPC Pool (secondary failover).
- Never query deprecated endpoints in production; they return 410 Gone / 403 Forbidden errors.

### 12.2 Failover & Rate-Limit Backoff

- Implement automatic failover: if an RPC request fails with a 429 (rate limit) or 5xx error, retry on the next endpoint in the list.
- Log all RPC failures with timestamps and endpoint names.
- After a failover, gradually resume usage on the primary endpoint (exponential backoff).

### 12.3 WebSocket Connection Management

- Use dedicated WebSocket endpoints for event subscriptions.
- Reconnect with exponential backoff on disconnect.
- Do not send unauthenticated WebSocket requests; include API credentials where required.

---

## 13. EVM Parallel Execution & Flash Liquidator Guard (`evm-mev`)

### 13.1 Parallel EVM Simulation

- For parallel EVM networks (Monad, Sei v2), **always simulate transactions via `eth_call` before submission**.
- Parallel execution means ordering is not guaranteed; a front-runner may liquidate the same position between your simulation and inclusion.
- Simulate immediately before submission to minimize the time window.

### 13.2 minProfit Invariant Enforcement

- Inside `FlashLiquidator.sol`, **enforce** `require(remainingProfit >= params.minProfit)` at the final step.
- If DEX slippage, fees, or multiple sandwich attacks reduce profit below the threshold, the contract reverts.
- Never use `try-catch` to suppress the revert; a failed liquidation is the correct outcome when profit is insufficient.

### 13.3 Flash Loan Selection

- Prefer Balancer Vault 0% fee flash loans where liquidity is available.
- Fall back to Aave v3 simple flash loans (0.05% fee) if Balancer lacks sufficient liquidity.
- Log the fee and adjust `minProfit` accordingly.

---

## 14. Security & Package Override Integrity

### 14.1 Dependabot & npm audit

- **Never** run destructive global downgrades like `npm audit fix --force`.
- Destructive fixes downgrade transitive dependencies and break Sui/Move SDK compatibility.

### 14.2 Preserving Critical Packages

- Always use root and workspace `overrides` or `resolutions` to preserve critical Move SDK packages:
  - `@scallop-io/sui-scallop-sdk`
  - `@cetusprotocol/cetus-sui-clmm-sdk`
  - `@mysten/sui.js` (pinned to a tested version)
- Review the Dependabot alert, understand the vulnerability, and apply a targeted patch.
- Test the patched version against the local test suite before committing.

### 14.3 Lockfile Review

- Always review lockfile changes in PRs. Never auto-merge dependency updates.
- Ensure transitive dependency versions remain compatible with Sui SDK.

---

## 15. Dynamic Profit Threshold & Near-Strike Surveillance

### 15.1 Minimum Profit Gate

- **Only execute liquidations** when estimated **net profit after gas, fees, and slippage** satisfies the configured threshold (`MIN_PROFIT_USD`, default `$5.00+`).
- Do not execute at a loss or to break even; always demand positive margin.

### 15.2 Surveillance Priority Tiers

Maintain active surveillance with tiered polling frequency:

- **Strike Tier** (Health Factor < 1.0000):
  - Immediate simulation & broadcast.
  - No polling delay; liquidate as soon as the obligation enters this tier.
  
- **Near-Strike Tier** (1.0000 ≤ Health Factor < 1.0700):
  - High-frequency sub-second polling.
  - Focus on top high-debt positions and whale accounts.
  - Expected polling interval: 200–500 ms.
  
- **Monitoring Tier** (Health Factor ≥ 1.0700):
  - Periodic background sweep.
  - Expected polling interval: 5–30 seconds.

### 15.3 Whale Position Tracking

- Maintain a list of top accounts by total debt USD.
- Prioritize monitoring whale positions in the Near-Strike and Strike tiers.
- Log liquidation events with account ID, profit, and health factor at the time of execution.

---

## 16. Session & Execution Logging

### 16.1 Audit Trail (Mandatory)

Every liquidation session **MUST log**:

1. **Pre-simulation state:**
   - Obligation ID, borrower address, health factor (off-chain and on-chain).
   - Collateral assets, collateral values USD, debt assets, debt values USD.
   - Current oracle prices and staleness timestamps.
   - Gas prices and estimated gas cost.

2. **Simulation result:**
   - Seize amount, liquidation bonus applied, DEX swap amount, swap slippage.
   - Flash loan fee, all deductions.
   - Gross profit, net profit USD, and decision (execute/skip).

3. **Execution trace (if broadcast):**
   - Transaction digest, checkpoint number, state version.
   - Actual gas used, actual fees, actual profit realized.
   - Timestamp (block time, Pyth update time).

4. **Failure cases:**
   - Abort codes, exact error messages.
   - Reason for skip (bad debt, dust, unhealthy, low profit, stale prices, etc.).

### 16.2 No Sensitive Data in Logs

- Never log full private keys, signed transactions, or operator wallet seeds.
- Truncate wallet addresses to first 6 and last 6 characters: `suix...abcde`.
- Truncate transaction digests to first 10 characters and context (e.g., `digest: 5a7b9c...`).

---

## 17. Responsibility & Operator Approval

### 17.1 Human Oversight

- No MEV bot feature goes into production without explicit operator configuration and approval.
- The `.env` file is untracked; it is the operator's responsibility to configure credentials and thresholds.
- An agent may not override or weaken safety checks to execute a liquidation without operator consent.

### 17.2 Operational Readiness Checklist

Before enabling live execution on mainnet:

- [ ] Operator has reviewed the strategy, protocol integrations, and risk model.
- [ ] Operator has verified the RPC endpoints, credentials, and wallet setup.
- [ ] Operator has tested the bot on testnet/devnet with small positions.
- [ ] Operator has set appropriate profit thresholds, slippage limits, and surveillance tiers.
- [ ] Operator has reviewed the audit trail and logging configuration.
- [ ] Operator has confirmed `DRY_RUN=false` and given explicit written approval.
- [ ] Operator has set up monitoring, alerts, and incident response procedures.

### 17.3 Incident Response

- If a liquidation loses money, produces unexpected results, or fails to execute, **immediately log the full details**.
- Do not attempt to recover or hide the incident.
- Pause automated execution, analyze the root cause, and wait for operator guidance before resuming.

---

## Summary: The Real-World MEV Engineer's Commitment

This is production code for a real Sui MEV liquidation searcher. Every agent working on this project commits to:

1. **Truthfulness first:** Never exaggerate, fabricate, or omit failures.
2. **Verification discipline:** Verify all data against authoritative sources and current on-chain state.
3. **Safety guarantees:** Enforce profit invariants, prevent bad-debt liquidation, and always simulate before broadcast.
4. **Code quality:** Pass all tests, document requirements, and review every change for capital-preservation and execution safety.
5. **Operational honesty:** Clearly communicate what is implemented, tested, verified, and ready for live execution.

**If a feature is not ready, say so. If a test fails, fix it. If a liquidation would lose money, skip it. The user's capital depends on our accuracy and discipline.**

---

## Glossary of Terms

- **PTB:** Programmable Transaction Block (Sui native transaction).
- **Flash Loan:** A zero-capital loan that must be repaid within the same transaction.
- **Health Factor (HF):** Ratio of collateral value to debt value. HF < 1.0 means undercollateralized.
- **Close Factor:** Maximum fraction of an obligation's debt that can be repaid in a single liquidation (e.g., 50%).
- **Liquidation Bonus:** Percentage of collateral seized as incentive (e.g., 5–8%).
- **Abort Code:** Sui Move execution error code (e.g., abort 2 = obligation is healthy).
- **Pyth:** Oracle service providing price feeds via sponsorship or subscription.
- **CLMM:** Concentrated Liquidity Market Maker (Cetus protocol).
- **DEX:** Decentralized exchange (e.g., Cetus, DeepBook, DragonSwap, Uniswap v3).
- **DRY_RUN:** Safety mode where all transactions are simulated but not broadcast.
- **minProfit:** Minimum acceptable net profit after all fees and slippage.
- **Stale Price:** Oracle price older than the protocol's configured freshness threshold.
- **Bad Debt:** A position with zero or negative collateral, unexecutable via flash loan liquidation.
