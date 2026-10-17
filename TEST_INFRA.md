# SuiMEV Test Infrastructure Specification (TEST_INFRA.md)

## 1. Overview & Test Architecture
This document specifies the end-to-end (E2E) test infrastructure and quality assurance framework for the SuiMEV liquidator bot expansion and Dart CLI dashboard.
The test infrastructure enforces a strict **4-Tier Testing Methodology**:
- **Tier 1: Feature Coverage in Isolation**: Minimum 5 test cases per feature covering all 18 features (F1–F18) in isolation (90 test cases total).
- **Tier 2: Boundary & Corner Cases**: Minimum 5 edge and boundary cases per feature (90 test cases total) evaluating precision, missing resources, corrupt state, zero collateral, extreme debt, and file lock contention.
- **Tier 3: Cross-Feature Combinations**: Multi-subsystem integration scenarios verifying decoupled engine daemons, multi-hop DEX swaps, dynamic oracle refresh, and ring buffer synchronization.
- **Tier 4: Real-World Workload Scenarios**: High-fidelity operational simulations mimicking live mainnet conditions, whale account defaults, burst liquidations, telemetry broadcast, and headless dashboard consumption.

```
+---------------------------------------------------------------------------------------------------+
|                                   SuiMEV Liquidator Test Suite                                    |
+---------------------------------------------------------------------------------------------------+
|  Tier 1: Feature Coverage (F1–F18 Isolated Invariants)                                            |
|  ├── Coins & Dex (F1–F6)       ├── Oracles & Math (F7–F8)    ├── Engine Telemetry (F9–F12)        |
|  └── Dart CLI Models & UI (F13–F17)                          └── Test Infrastructure (F18)         |
+---------------------------------------------------------------------------------------------------+
|  Tier 2: Boundary & Corner Cases                                                                  |
|  ├── Numerical limits (UINT64, decimals: 0, 6, 8, 9, 18)     ├── Missing / Truncated telemetry    |
|  ├── Corrupted JSON payloads                                 ├── File lock contention (EBUSY)     |
|  └── Zero collateral bad debt                                └── Non-interactive terminals        |
+---------------------------------------------------------------------------------------------------+
|  Tier 3: Cross-Feature Integration Combinations                                                   |
|  ├── Atomic state bridge persistence through engine restart                                       |
|  ├── Multi-coin 2-hop flash swap with on-chain Pyth refresh                                        |
|  ├── Hot watchlist migration on dynamic price tick                                                |
|  └── Burst liquidation ring buffer eviction during continuous telemetry export                    |
+---------------------------------------------------------------------------------------------------+
|  Tier 4: Real-World Operational Workloads                                                         |
|  ├── Whale position liquidation strike with telemetry broadcast and dashboard consumption        |
|  ├── Multi-protocol cascading liquidation storm (NAVI + Scallop)                                  |
|  └── Network partition & recovery with persistent zero-crash UI                                   |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Feature Inventory Reference
| ID | Feature Name | Core Target | Implementation Target |
|---|---|---|---|
| F1 | AUSD Coin Configuration | Verified type `0x2053...2ff2`, 6 decimals, NAVI pool 9, Pyth feed `0xfaec...` | `src/config/coins.ts` |
| F2 | LBTC Coin Configuration | Verified type `0x3e8e...9040`, 8 decimals, NAVI pool 23, Pyth feed `0x9eae...` | `src/config/coins.ts`, `priceCache.ts` |
| F3 | NS Coin Configuration | Verified type `0x5145...178`, 6 decimals, NAVI pool 13, Pyth feed `0xea0d...` | `src/config/coins.ts` |
| F4 | afSUI Coin Configuration | Verified type `0xf325...efc`, 9 decimals, Pyth redemption rate valuation | `src/config/coins.ts` |
| F5 | Symbol Resolution & Mapping | Canonical lookup for `NAVX`, `haSUI`, `SCA`, `DEEP`, `CETUS`, `AUSD`, `LBTC`, `NS`, `afSUI` | `src/config/coins.ts` |
| F6 | Cetus CLMM Pools & Dynamic Sync | Verified pools (`USDC/AUSD`, `LBTC/SUI`, `NS/SUI`, `afSUI/SUI`, `SCA/SUI`), fallback handling | `src/protocols/dex/cetusRouter.ts` |
| F7 | On-Chain Pyth Price Objects | Direct Sui object queries (`PriceInfoObject`) bypassing Hermes 403 errors | `src/oracles/pythService.ts` |
| F8 | Precision & Health Invariant Verification | Mixed-decimal health factor math (6, 8, 9 decimals) and zero-capital liquidation solvency | `src/oracles/healthFactor.ts`, `ptbBuilder.ts` |
| F9 | Disaggregated Obligation Counts | `ObligationRegistry.getCounts()` returning `naviCount` and `scallopCount` | `src/engine/registry.ts` |
| F10 | Liquidation Event Ring Buffer | 15-event FIFO buffer recording borrower, debt repaid, collateral seized, net profit, tx link | `src/engine/executor.ts`, `telemetry.ts` |
| F11 | Atomic Telemetry Bridge Daemon | 1000ms loop writing `.state/telemetry.json.tmp` -> `.state/telemetry.json` with 3-retry lock guard | `src/engine/telemetryBridge.ts` |
| F12 | Zero-RPC Operator Gas Tracking | Synchronous extraction of `gasManager.getCachedBalanceSui()` in telemetry payload | `src/client/gasManager.ts` |
| F13 | Dart CLI Package Scaffolding | Modern `dashboard_cli/` layout following `dart-build-cli-app`, thin trampoline `bin/dashboard.dart` | `dashboard_cli/` |
| F14 | Non-Destructive Terminal Lifecycle | Windows-safe signal handlers (`sigterm` guard), cursor restore `\x1B[?25h`, raw mode teardown | `dashboard_cli/lib/src/lifecycle.dart` |
| F15 | Human-Readable Dashboard UI | Status Header (`● LIVE ENGINE ONLINE`), Gas & PnL Overview, 3-Tier Watchlist, Activity Feed | `dashboard_cli/lib/src/renderer/` |
| F16 | Interactive Keyboard Controls | Raw mode key processing: `q` (quit), `r` (refresh), `c` (color mode toggle), `h` (help) | `dashboard_cli/lib/src/cli.dart` |
| F17 | Zero-Crash Graceful Degradation | Missing/partial telemetry handling, braille spinner (`⠋`, `⠙`...), exponential retry | `dashboard_cli/lib/src/poller/` |
| F18 | Comprehensive Testing & Verification | 4-tier E2E testing framework, automated test runner, zero linter warnings | `tests/e2e/`, `TEST_READY.md` |

---

## 3. Tier 1: Feature Coverage (>=5 Tests per Feature, F1–F18)

### F1: AUSD Coin Configuration
- **T1.F1.1**: Type tag normalization matches canonical package `0x2053...2ff2::ausd::AUSD`.
- **T1.F1.2**: Decimals strictly equal 6 matching on-chain `CoinMetadata`.
- **T1.F1.3**: NAVI reserve pool ID strictly equals 9 (preventing conflict with wBTC pool 21).
- **T1.F1.4**: Pyth price feed ID `0xfaec36b7b45f96ed1b949ed45758dfa73d071f48509e550eec41ad3cfa00d1bd` is valid 32-byte hex.
- **T1.F1.5**: Liquidation threshold and bonus are populated (LT = 0.90, LB = 0.05).

### F2: LBTC Coin Configuration
- **T1.F2.1**: Type tag normalization matches canonical package `0x3e8e...9040::lbtc::LBTC`.
- **T1.F2.2**: Decimals strictly equal 8 (Bitcoin satoshi standard on Sui).
- **T1.F2.3**: NAVI reserve pool ID strictly equals 23.
- **T1.F2.4**: Seed price in `priceCache.ts` is initialized with valid non-zero positive number (e.g. ~$82,000+).
- **T1.F2.5**: Pyth price feed ID `0x9eaebfc21b14ea517575097e7787fe73ab92113525d7ad9acce983a2ae2570dc` is valid.

### F3: NS Coin Configuration
- **T1.F3.1**: Type tag matches canonical package `0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS`.
- **T1.F3.2**: Decimals strictly equal 6 (preventing 1,000x decimal valuation error in Scallop indexer).
- **T1.F3.3**: NAVI reserve pool ID strictly equals 13 (preventing conflict with BLUE pool 17).
- **T1.F3.4**: Pyth price feed ID `0xea0d962a2b2cb35bbc262514ea6cfed02fdb3d5bedb193ca0d50bfefc98abebc` is registered.
- **T1.F3.5**: Reverse lookup by coin type string resolves symbol `'NS'`.

### F4: afSUI Coin Configuration
- **T1.F4.1**: Type tag matches canonical package `0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI`.
- **T1.F4.2**: Decimals strictly equal 9 matching Sui native token precision.
- **T1.F4.3**: Valuation logic handles redemption rate multiplier relative to base SUI price.
- **T1.F4.4**: Registered in price cache seed table with premium factor $\ge 1.0 \times SUI$.
- **T1.F4.5**: Liquidation threshold configured to 0.85 and liquidation bonus to 0.05.

### F5: Symbol Resolution & Mapping
- **T1.F5.1**: `getCoinConfigBySymbol('NAVX')` resolves valid config (`NAVI` alias handling).
- **T1.F5.2**: `getCoinConfigBySymbol('haSUI')` and `haSui` resolve case-insensitively.
- **T1.F5.3**: `getCoinConfigBySymbol('SCA')` resolves Scallop token with decimals: 9.
- **T1.F5.4**: `getCoinConfigBySymbol('DEEP')` resolves DeepBook token with decimals: 6.
- **T1.F5.5**: `getCoinConfigBySymbol('CETUS')` resolves Cetus token with decimals: 9.

### F6: Cetus CLMM Pools & Dynamic Sync
- **T1.F6.1**: Static pool registry includes active `USDC/AUSD` pool `0x0fea99ed9c65068638963a81587c3b8cafb71dc38c545319f008f7e9feb2b5f8`.
- **T1.F6.2**: Static pool registry includes active `LBTC/SUI` pool `0x2fc6ee9183d0f1ca0d2dded02c416be6f4671bb82db55c26ce12b536812a4b8e`.
- **T1.F6.3**: Static pool registry includes active `NS/SUI` pool `0x763f63cbada3a932c46972c6c6dcf1abd8a9a73331908a1d7ef24c2232d85520`.
- **T1.F6.4**: Static pool registry includes active `afSUI/SUI` pool `0xa528b26eae41bcfca488a9feaa3dca614b2a1d9b9b5c78c256918ced051d4c50`.
- **T1.F6.5**: `syncDynamicPools()` falls back gracefully to static pools if Cetus API returns empty array or HTTP error.

### F7: On-Chain Pyth Price Objects
- **T1.F7.1**: `ON_CHAIN_PYTH_OBJECTS` contains AUSD object `0xfaec...d1bd`.
- **T1.F7.2**: `ON_CHAIN_PYTH_OBJECTS` contains LBTC object `0x9eae...70dc`.
- **T1.F7.3**: `ON_CHAIN_PYTH_OBJECTS` contains NS object `0xea0d...bebc`.
- **T1.F7.4**: On-chain price object extractor handles 64-bit signed price and negative exponent.
- **T1.F7.5**: Pyth on-chain fetch succeeds without invoking Hermes HTTP endpoint.

### F8: Precision & Health Invariant Verification
- **T1.F8.1**: `HealthFactorEngine` correctly evaluates 8-decimal debt (LBTC) against 9-decimal collateral (SUI).
- **T1.F8.2**: `HealthFactorEngine` correctly evaluates 6-decimal debt (AUSD) against 6-decimal collateral (USDC).
- **T1.F8.3**: Accounts with $HF < 1.0$ and positive collateral/debt are bucketed into `immediateTargets`.
- **T1.F8.4**: Zero-capital liquidation check rejects accounts with $0 collateral (bad debt).
- **T1.F8.5**: PTB builder applies close factor (0.50 on NAVI, 1.00 on Scallop) without over-repayment.

### F9: Disaggregated Obligation Counts
- **T1.F9.1**: `ObligationRegistry.getCounts()` returns `naviCount` and `scallopCount` as non-negative integers.
- **T1.F9.2**: Adding a NAVI obligation increments `naviCount` and leaves `scallopCount` unchanged.
- **T1.F9.3**: Adding a Scallop obligation increments `scallopCount` and leaves `naviCount` unchanged.
- **T1.F9.4**: `totalMonitored` strictly equals `naviCount + scallopCount`.
- **T1.F9.5**: Obligation count categorization correctly splits into `immediateTargetsCount`, `hotWatchlistCount`, and `safeCount`.

### F10: Liquidation Event Ring Buffer
- **T1.F10.1**: Ring buffer stores latest liquidation event with exact schema (timestamp, protocol, borrower, debtRepaid, collateralSeized, netProfitUsd, gasCostSui, txDigest, txDigestLink).
- **T1.F10.2**: Ring buffer captures events from dry-run / simulation executions.
- **T1.F10.3**: Ring buffer captures events from live on-chain executions.
- **T1.F10.4**: Ring buffer caps at exactly 15 events, evicting oldest entry on 16th event (FIFO).
- **T1.F10.5**: `txDigestLink` matches canonical format `https://suiscan.xyz/mainnet/tx/<digest>`.

### F11: Atomic Telemetry Bridge Daemon
- **T1.F11.1**: Telemetry export writes to `.state/telemetry.json.tmp` before renaming to `.state/telemetry.json`.
- **T1.F11.2**: Windows file lock retry loop catches `EBUSY` / `EPERM` and retries up to 3 times with exponential backoff.
- **T1.F11.3**: Automatic recursive directory creation ensures `.state/` is created if missing.
- **T1.F11.4**: Output JSON conforms 100% to PROJECT.md interface contract schema.
- **T1.F11.5**: Telemetry export runs unref'd without delaying or blocking the searcher tick loop.

### F12: Zero-RPC Operator Gas Tracking
- **T1.F12.1**: `gasManager.getCachedBalanceSui()` returns in memory within $<1\text{ms}$ with zero RPC network requests.
- **T1.F12.2**: Gas tank balance in telemetry reflects both SUI float (`gasTankBalanceSui`) and MIST string (`gasTankBalanceMist`).
- **T1.F12.3**: Conversion between MIST and SUI maintains exact decimal precision ($1\text{ SUI} = 10^9\text{ MIST}$).
- **T1.F12.4**: Operator wallet address in telemetry matches configured public key.
- **T1.F12.5**: Gas cache invalidation updates cached balance upon next gas coin split or broadcast.

### F13: Dart CLI Package Scaffolding
- **T1.F13.1**: `dashboard_cli/pubspec.yaml` specifies package `dashboard_cli`, sdk `>=3.0.0`, and dependencies `args`, `io`.
- **T1.F13.2**: `dashboard_cli/pubspec.yaml` declares executable entrypoint `dashboard: dashboard`.
- **T1.F13.3**: Thin entrypoint pattern: `bin/dashboard.dart` is under 15 lines and delegates to `lib/src/cli.dart`.
- **T1.F13.4**: Clean module directory layout exists: `lib/src/models/`, `lib/src/poller/`, `lib/src/renderer/`, `lib/src/terminal/`.
- **T1.F13.5**: `analysis_options.yaml` enables pedantic lint rules.

### F14: Non-Destructive Terminal Lifecycle
- **T1.F14.1**: Terminal exit handling assigns `exitCode = ...` and does not invoke raw `exit()`.
- **T1.F14.2**: Teardown sequence emits ANSI cursor visible escape sequence `\x1B[?25h`.
- **T1.F14.3**: Terminal raw mode is restored to normal line and echo mode (`echoMode = true`, `lineMode = true`).
- **T1.F14.4**: Windows signal listener guards against `ProcessSignal.sigterm` on Windows platform (`if (!Platform.isWindows)`).
- **T1.F14.5**: Teardown executes reliably inside `finally` block even when uncaught exceptions occur.

### F15: Human-Readable Dashboard UI
- **T1.F15.1**: Status Header renders prominent indicator (`● LIVE ENGINE ONLINE` in green or `● ENGINE OFFLINE` in red).
- **T1.F15.2**: Financial card displays gas tank balance in SUI and net realized PnL in USD.
- **T1.F15.3**: Watchlist card categorizes items into Red ($HF < 1.0$), Yellow ($1.00 \le HF < 1.05$), and Green ($HF \ge 1.05$).
- **T1.F15.4**: Activity ticker card renders recent liquidation strikes with relative timestamps and shortened digests.
- **T1.F15.5**: ANSI rendering honors `NO_COLOR` environment variable and non-interactive `stdout.hasTerminal = false`.

### F16: Interactive Keyboard Controls
- **T1.F16.1**: Keypress `'q'` or `'Q'` initiates graceful shutdown sequence and sets exit code 0.
- **T1.F16.2**: Keypress `'r'` or `'R'` triggers immediate re-read of telemetry file bypassing poll timer.
- **T1.F16.3**: Keypress `'c'` or `'C'` toggles color palette between ANSI full color and monochrome.
- **T1.F16.4**: Keypress `'h'` or `'H'` displays keyboard shortcut guide card.
- **T1.F16.5**: Unrecognized keystrokes are ignored without crashing or causing terminal escape sequence leaks.

### F17: Zero-Crash Graceful Degradation
- **T1.F17.1**: Initial absence of `.state/telemetry.json` displays animated braille spinner (`⠋`, `⠙`, `⠹`...) with waiting message.
- **T1.F17.2**: Empty file (`0 bytes`) during write window is caught as transient state and retried.
- **T1.F17.3**: Malformed JSON syntax during rename does not crash CLI poller; previous valid frame is retained.
- **T1.F17.4**: File poller applies exponential retry backoff (e.g. 50ms, 100ms, 200ms) up to max cap.
- **T1.F17.5**: Poller resumes live updates automatically as soon as valid telemetry file appears.

### F18: Comprehensive Testing & Verification
- **T1.F18.1**: All unit and E2E test suites pass with 100% success rate (`vitest run`).
- **T1.F18.2**: TypeScript static analysis passes with 0 errors (`tsc --noEmit`).
- **T1.F18.3**: Dart static analysis passes with 0 errors and 0 warnings (`dart analyze`).
- **T1.F18.4**: No test uses hardcoded mock facades that bypass real business logic.
- **T1.F18.5**: Tests are fully isolated and clean up temporary files in `.state/` and test workspaces.

---

## 4. Tier 2: Boundary & Corner Cases (>=5 Tests per Feature, F1–F18)

### Boundary Cases Summary (F1–F18)
| Feature | Boundary 1 | Boundary 2 | Boundary 3 | Boundary 4 | Boundary 5 |
|---|---|---|---|---|---|
| **F1 (AUSD)** | 0 MIST balance | Max UINT64 (18.44M AUSD) | Sub-cent fraction ($0.000001) | Malformed package address | Leading zero address normalization |
| **F2 (LBTC)** | 1 Satoshi (0.00000001 BTC) | 21 Million BTC max satoshis | Missing seed price in cache | Expired Pyth price timestamp | Stale confidence interval (>10% price) |
| **F3 (NS)** | Sub-micro NS amount | Extremely large NS position ($10M+) | Incorrect 9-decimal override attempt | Unknown reserve ID fallback | Empty string coin type lookup |
| **F4 (afSUI)** | Zero SUI conversion rate | afSUI/SUI de-peg ($<0.80) | Extreme redemption premium ($>2.0) | Negative exponent price unpack | Non-normalized type tag lookup |
| **F5 (Symbols)** | Whitespace padding (`" NAVX "`) | Mixed casing (`"aUsD"`) | Unregistered symbol (`"UNKNOWN"`) | Symbol identical to prefix of another | Non-ASCII Unicode symbol input |
| **F6 (Cetus)** | Zero liquidity pool | Max slippage 100% (10000 bps) | 0 bps slippage exact match | Dead pool address returning 404 | 2-hop route through inactive intermediary |
| **F7 (Pyth Objs)** | RPC returns `deleted` object | Price confidence $= 0$ | Extreme negative exponent ($-18$) | On-chain object version desync | Batch request with mixed valid/invalid IDs |
| **F8 (Health)** | Exact boundary $HF = 1.00000$ | Exact boundary $HF = 1.05000$ | $0 Collateral with $>0 Debt (Bad Debt) | $0 Debt with $>0 Collateral (Pure Deposit) | Max integer overflow in collateral sum |
| **F9 (Counts)** | Zero total obligations monitored | 100,000+ obligations scale | Rapid insertion/deletion of same key | Deletion of non-existent key | Desynced protocol type string |
| **F10 (Ring Buffer)**| Rapid burst (100 events in 10ms) | Event with missing optional txDigest | Empty string borrower address | Negative net profit (loss event) | Special characters in error message |
| **F11 (Telemetry)** | Windows `EBUSY` on locked temp file | Windows `EPERM` during rename | Directory `.state/` readonly | Crash during atomic rename | Truncated write on disk full |
| **F12 (Gas Track)** | Gas tank balance $= 0.0$ SUI | Primary gas coin object is null | Gas coin split in flight | Balance exceeds standard wallet balance | Multiple concurrent gas queries |
| **F13 (Dart Layout)**| Missing `pubspec.yaml` | Trailing slashes in CLI arguments | Missing `bin/dashboard.dart` trampoline| Incompatible Dart SDK version constraint | Corrupted dependency lockfile |
| **F14 (Lifecycle)** | Rapid double SIGINT (Ctrl+C twice) | Terminal resize mid-frame | stdout redirected to file (`> out.txt`)| SIGTERM received on Windows host | stdin closed abruptly (EOF / pipe closed)|
| **F15 (UI Cards)** | Terminal width $< 40$ columns | 1,000+ items in hot watchlist | Debt amount formatting $> \$1\text{B}$ | Extreme negative PnL display | ANSI terminal without 256-color support |
| **F16 (Keys)** | Fast repeated keypresses (buffer spam)| Non-printable control characters | Terminal arrow keys escape sequences | EOF on stdin | Keypress during frame redraw |
| **F17 (Graceful)** | Corrupted JSON: trailing commas | JSON containing unexpected extra keys | JSON missing top-level `financials` | Rapid file deletion and recreation | Telemetry file replaced with directory |
| **F18 (Testing)** | Test timeout on slow filesystem | Asynchronous race in test cleanup | Parallel test execution file collision | Mock clock drift in timer tests | Test execution in non-TTY CI environment |

---

## 5. Tier 3: Cross-Feature Combinations (Integration Scenarios)

1. **Scenario 3.1: Engine Restart Telemetry Persistence & Dashboard Continuity**
   - *Subsystems*: F11 (Telemetry Daemon), F10 (Ring Buffer), F15 (UI), F17 (Graceful Poller).
   - *Flow*: Engine records 5 liquidation events and exports telemetry; engine process stops; Dart CLI poller detects stale timestamp, renders waiting state; engine restarts with initialized ring buffer; poller resumes live feed without dropped frames or terminal artifacts.

2. **Scenario 3.2: Multi-Coin 2-Hop Flash Swap Routing with Whole-Obligation Oracle Refresh**
   - *Subsystems*: F1 (AUSD), F2 (LBTC), F6 (Cetus 2-hop), F7 (Pyth Objects), F8 (PTB Builder).
   - *Flow*: Distressed borrower has LBTC debt and AUSD collateral; Cetus router routes AUSD -> SUI -> LBTC; PTB builder prepends Pyth on-chain updates for both LBTC and AUSD; verifies atomic balance consumption without Move abort.

3. **Scenario 3.3: High-Frequency Price Volatility & Watchlist Migration Cascade**
   - *Subsystems*: F2 (LBTC), F7 (Pyth), F8 (Health Factor), F9 (Disaggregated Counts), F11 (Telemetry).
   - *Flow*: Pyth LBTC price increases by 8%; `ObligationRegistry.reevaluateHotWatchlist()` transitions 3 accounts from Safe ($HF = 1.08 \to 1.02$) to Hot, and 1 account to Immediate ($HF = 0.99$); disaggregated counts update in telemetry within 1 export cycle.

4. **Scenario 3.4: Concurrent Atomic Rename under Rapid Polling Reader Contention**
   - *Subsystems*: F11 (Atomic Telemetry Bridge), F17 (Telemetry Reader).
   - *Flow*: Engine writes telemetry every 200ms; Dart CLI poller reads every 50ms; Windows file lock collisions occur; verified that 3-retry backoff in writer and reader prevents any crash, unhandled rejection, or partial JSON read.

5. **Scenario 3.5: Burst Liquidation Ring Buffer FIFO Overflow & Telemetry Sync**
   - *Subsystems*: F10 (Ring Buffer), F11 (Telemetry Bridge), F15 (Activity Feed).
   - *Flow*: Engine executes 25 liquidations in rapid succession; ring buffer retains precisely the latest 15 events in FIFO order; exported telemetry reflects new strikes with Suiscan links; UI activity ticker updates smoothly.

6. **Scenario 3.6: Mixed-Decimal Zero-Capital Solvency Guard**
   - *Subsystems*: F1 (AUSD, 6 dec), F4 (afSUI, 9 dec), F8 (Health & PTB Builder).
   - *Flow*: Borrower holds afSUI collateral and AUSD debt; engine evaluates exchange rate and health factor; verifies minProfit check enforces net positive yield after gas and DEX fees before signing PTB.

7. **Scenario 3.7: Operator Gas Depletion & Zero-RPC Recovery**
   - *Subsystems*: F12 (Gas Tracking), F11 (Telemetry Bridge), F15 (Dashboard UI).
   - *Flow*: Operator executes 10 transactions consuming gas; cached gas balance drops from 10.0 to 9.2 SUI; telemetry reflects updated balance without making RPC calls; UI displays gas tank warning if balance drops below threshold.

8. **Scenario 3.8: Dart CLI Teardown under Rapid Keystrokes & Signals**
   - *Subsystems*: F14 (Lifecycle), F16 (Keyboard Controls), F15 (Terminal UI).
   - *Flow*: User toggles color mode ('c'), requests refresh ('r'), then presses 'q'; terminal restores raw mode, unhides cursor, cancels poller timer, and exits cleanly with code 0.

9. **Scenario 3.9: Multi-Protocol Monitored Counts with Protocol-Specific Scaling**
   - *Subsystems*: F9 (Obligation Counts), F11 (Telemetry), F15 (UI Card).
   - *Flow*: Engine syncs 850 NAVI obligations and 570 Scallop obligations; verified telemetry exports `naviCount: 850`, `scallopCount: 570`, `totalMonitored: 1420`; UI card renders protocol breakdown bar.

10. **Scenario 3.10: Pyth Hermes Network Dropout with On-Chain Object Fallback**
    - *Subsystems*: F7 (Pyth Objects), F1 (AUSD), F2 (LBTC), F3 (NS).
    - *Flow*: Pyth Hermes REST endpoint simulated with HTTP 403 / 500; engine falls back transparently to direct `PriceInfoObject` RPC read; price cache updates without stale price abort (Abort 1025 Guard).

---

## 6. Tier 4: Real-World Workload Scenarios

### Scenario 4.1: End-to-End Whale Liquidation Strike & Live Dashboard Broadcast
- **Context**: A high-debt whale account on NAVI holds $15,420 USDC debt and $15,780 SUI collateral. SUI spot price drops by 3.5%, plunging account health factor from 1.025 to 0.985 (Strike Tier).
- **Execution Flow**:
  1. Engine searcher tick loop detects undercollateralized target ($HF < 1.00$).
  2. PTB Builder constructs atomic liquidation transaction block with Pyth price refresh, flash loan borrow, liquidation call, Cetus collateral swap, and loan repayment with minProfit check.
  3. Pre-flight simulation (`devInspectTransactionBlock`) confirms positive net profit ($42.15 USD).
  4. Executor records execution event in FIFO ring buffer with tx digest `5cZ8X...xyz` and Suiscan explorer URL.
  5. Telemetry Bridge gathers in-memory metrics, computes disaggregated counts, and atomically writes `.state/telemetry.json.tmp` -> `.state/telemetry.json`.
  6. Dart Live Feed CLI reads telemetry frame, renders Green/Yellow/Red card transitions, flashes Strike Alert, and updates cumulative realized PnL.

### Scenario 4.2: Cascading Multi-Protocol Market Crash Stress Test
- **Context**: Systemic crypto market drop causing simultaneous liquidation triggers across 10 accounts in NAVI and Scallop lending pools.
- **Execution Flow**:
  1. Obligation registry prioritizes targets sorted by total debt descending.
  2. Accounts with $0 collateral (bad debt) are immediately rejected by zero-capital solvency guard.
  3. Valid accounts are executed concurrently within configured concurrency limits.
  4. Ring buffer absorbs high-throughput strikes without memory leak or buffer overflow.
  5. Telemetry bridge maintains continuous 1000ms export cadence with 0ms searcher loop blocking.

### Scenario 4.3: Long-Running Headless Engine Daemon with Detached Dashboard Clients
- **Context**: Engine runs 24/7 in headless Docker/Linux/Windows service mode while operators attach and detach Dart terminal dashboards intermittently.
- **Execution Flow**:
  1. Engine generates atomic `.state/telemetry.json` state updates every 1000ms.
  2. Client A attaches, monitors for 30 minutes, and exits cleanly via `q`. Terminal cursor and echo mode are restored without affecting host shell.
  3. Client B attaches during high load, exercises keyboard controls (`r`, `c`), and handles transient file writes seamlessly.
  4. Engine memory remains stable (<200MB RSS) with bounded ring buffer and cached gas coins.

---

## 7. Execution Guide & Verification Commands
- **Run Full Test Suite**:
  ```powershell
  npm test
  ```
- **Run Dedicated E2E Test Suite**:
  ```powershell
  npx vitest run tests/e2e
  ```
- **Run Static Type Audit**:
  ```powershell
  npm run audit:types
  ```
- **Run Dart Dashboard CLI Tests & Analyzer (Milestone 3/4)**:
  ```powershell
  cd dashboard_cli
  dart analyze
  dart test
  ```
