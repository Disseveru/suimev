# Project: SuiMEV Liquidator Bot Expansion & Dart CLI Dashboard

## Architecture
The system consists of three decoupled operational tiers:
1. **SuiMEV On-Chain Engine (TypeScript / Node.js)**:
   - High-performance liquidation engine monitoring NAVI and Scallop lending protocols on Sui Mainnet.
   - Core modules: Coin Registry (`src/config/coins.ts`), Pyth Oracle Service (`src/oracles/`), Cetus CLMM Router (`src/protocols/dex/cetusRouter.ts`), Obligation Registry (`src/engine/registry.ts`), and Transaction Executor (`src/engine/executor.ts`).
2. **Telemetry State Bridge (Decoupled Daemon)**:
   - `src/engine/telemetryBridge.ts` running an unref'd 1000ms loop, decoupled from the MEV hot path.
   - Gathers live in-memory metrics (operator gas tank balance, PnL, NAVI/Scallop obligation counts, hot watchlist $1.00 \le HF < 1.05$, and recent liquidation strikes).
   - Atomically exports to `.state/telemetry.json` using a temporary file (`.state/telemetry.json.tmp`) and atomic rename with a 3-retry Windows file lock guard.
3. **Dart Terminal Live Feed CLI (`dashboard_cli/`)**:
   - Standalone Dart terminal application following the `dart-build-cli-app` architectural pattern.
   - Thin entrypoint `bin/dashboard.dart` delegating to modular business logic in `lib/src/`.
   - Polling engine reading `.state/telemetry.json` with exponential backoff and animated braille spinner during initialization.
   - Non-destructive terminal teardown (cursor restoration, raw mode cleanup, Windows-safe signal listeners, setting `exitCode = ...`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | AUSD Coin Configuration | Add verified AUSD (`0x2053...2ff2`, 6 decimals, NAVI pool 9, Pyth feed `0xfaec...`) to `coins.ts` | M1 | Survey 1 |
| F2 | LBTC Coin Configuration | Add verified LBTC (`0x3e8e...9040`, 8 decimals, NAVI pool 23, Pyth feed `0x9eae...`, seed price) to `coins.ts` and `priceCache.ts` | M1 | Survey 1 |
| F3 | NS Coin Configuration | Update NS with verified package (`0x5145...178`, 6 decimals, NAVI pool 13, Pyth feed `0xea0d...`) | M1 | Survey 1 |
| F4 | afSUI Coin Configuration | Update afSUI with verified package (`0xf325...efc`, 9 decimals, Pyth redemption rate / USD valuation) | M1 | Survey 1 |
| F5 | Symbol Resolution & Mapping | Ensure `NAVX`, `haSUI`, `SCA`, `DEEP`, and `CETUS` resolve correctly in `getCoinConfigBySymbol` | M1 | Survey 1 |
| F6 | Cetus CLMM Pools & Dynamic Sync | Configure active pools (USDC/AUSD, LBTC/SUI, NS/SUI, afSUI/SUI, SCA/SUI) and fix `syncDynamicPools` query | M1 | Survey 1 |
| F7 | On-Chain Pyth Price Objects | Register verified `PriceInfoObject` IDs in `pythService.ts` to bypass Hermes 403 errors | M1 | Survey 1 |
| F8 | Precision & Health Invariant Verification | Verify `healthFactor.ts` and `ptbBuilder.ts` handle newly added assets without precision loss | M1 | Survey 1 |
| F9 | Disaggregated Obligation Counts | Extend `ObligationRegistry.getCounts()` with separate `navi` and `scallop` monitored counts | M2 | Survey 2 |
| F10 | Liquidation Event Ring Buffer | Add 15-event FIFO ring buffer in engine/executor capturing live and dry-run strikes with Suiscan links | M2 | Survey 2 |
| F11 | Atomic Telemetry Bridge Daemon | Implement `TelemetryBridge` with 1000ms loop, writing `.state/telemetry.json.tmp` -> `.state/telemetry.json` | M2 | Survey 2 |
| F12 | Zero-RPC Operator Gas Tracking | Expose `gasManager.getCachedBalanceSui()` synchronously in telemetry payload | M2 | Survey 2 |
| F13 | Dart CLI Package Scaffolding | Create `dashboard_cli/` with `pubspec.yaml`, `bin/dashboard.dart`, and `lib/src/` per `dart-build-cli-app` | M3 | Survey 3 |
| F14 | Non-Destructive Terminal Lifecycle | Implement signal handling (Windows-safe), cursor restore (`\x1B[?25h`), raw mode teardown, `exitCode` | M3 | Survey 3 |
| F15 | Human-Readable Dashboard UI | Render Status Header, Gas Tank & PnL, 3-Tier Watchlist (Red/Yellow/Green), and Activity Feed | M3 | Survey 3 |
| F16 | Interactive Keyboard Controls | Support `q` (quit), `r` (manual refresh), `c` (toggle color mode), `h` (help) in raw input mode | M3 | Survey 3 |
| F17 | Zero-Crash Graceful Degradation | Handle missing or updating telemetry file with braille loading spinner and retry backoff | M3 | Survey 3 |
| F18 | Comprehensive Testing & Verification | Unit tests, static analysis (`audit:types`, `dart analyze`), E2E integration, and adversarial hardening | M4 | Survey 1,2,3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Sui Mainnet Coin Coverage Modernization & Expansion | Features F1–F8 (`src/config/coins.ts`, `cetusRouter.ts`, `pythService.ts`, `priceCache.ts`, tests) | None | DONE |
| M2 | Engine Telemetry State Bridge | Features F9–F12 (`src/engine/telemetryBridge.ts`, `registry.ts`, `executor.ts`, `searcher.ts`, `.gitignore`) | None | DONE |
| M3 | Non-Coder Friendly Dart Terminal Live Feed CLI | Features F13–F17 (`dashboard_cli/` complete package, models, poller, UI, lifecycle, tests) | M2 (Schema contract) | IN_PROGRESS |
| M4 | E2E Testing, Adversarial Hardening & Acceptance Gate | Feature F18 (Dual-track E2E verification, integration tests, adversarial stress testing) | M1, M2, M3 | PLANNED |

## Interface Contracts

### 1. Telemetry State Bridge ↔ Dart CLI Consumer (`.state/telemetry.json`)
The telemetry bridge writes this JSON payload atomically every 1000–1500ms:
```json
{
  "timestamp": "2026-10-16T10:45:00.000Z",
  "botStatus": "ONLINE",
  "operator": {
    "address": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    "gasTankBalanceSui": 14.8523,
    "gasTankBalanceMist": "14852300000"
  },
  "financials": {
    "netRealizedPnlUsd": 124.50,
    "cumulativeGasSpentSui": 1.254,
    "successfulLiquidations": 3,
    "failedLiquidations": 0,
    "totalSimulations": 842
  },
  "obligations": {
    "totalMonitored": 1420,
    "naviCount": 850,
    "scallopCount": 570,
    "immediateTargetsCount": 0,
    "hotWatchlistCount": 4,
    "safeCount": 1416
  },
  "hotWatchlist": [
    {
      "obligationId": "0xabc...123",
      "protocol": "navi",
      "borrower": "0xdef...456",
      "healthFactor": 1.0234,
      "totalDebtUsd": 15420.50,
      "totalCollateralUsd": 15780.00,
      "urgency": "HOT"
    }
  ],
  "recentLiquidations": [
    {
      "timestamp": "2026-10-16T10:42:15.000Z",
      "protocol": "scallop",
      "borrower": "0x789...abc",
      "debtRepaid": "5,000.00 USDC",
      "collateralSeized": "2,450.12 SUI",
      "netProfitUsd": 42.15,
      "gasCostSui": 0.045,
      "txDigest": "5cZ8X...xyz",
      "txDigestLink": "https://suiscan.xyz/mainnet/tx/5cZ8X...xyz"
    }
  ]
}
```

### 2. Coin Registry ↔ DEX Router & Oracles
- Every token configured in `COIN_CONFIGS` must supply:
  - `coinType`: Canonical on-chain type string (e.g. `0x2053...::ausd::AUSD`).
  - `decimals`: Exact integer matching on-chain `CoinMetadata`.
  - `pythFeedId`: Hex string of Pyth price feed.
  - `naviPoolId`: Integer reserve ID if supported on NAVI, or `undefined`.
- Cetus CLMM Router pool registry must have verified pool object IDs where `coinA` and `coinB` match on-chain pool types.

## Code Layout
```
c:\Users\mrmou\.antigravity-ide\suimev\
├── src/
│   ├── config/
│   │   ├── coins.ts            # (M1) Coin types, decimals, feeds, NAVI pool IDs
│   │   └── types.ts            # (M1/M2) Type definitions, TelemetryPayload, ObligationState
│   ├── protocols/
│   │   └── dex/
│   │       └── cetusRouter.ts  # (M1) Verified pools (AUSD, LBTC, NS, afSUI, SCA)
│   ├── oracles/
│   │   ├── pythService.ts      # (M1) On-chain PriceInfoObject IDs
│   │   └── priceCache.ts       # (M1) Seed prices & price cache
│   ├── engine/
│   │   ├── registry.ts         # (M2) NAVI/Scallop count breakdown, hot filtering
│   │   ├── executor.ts         # (M2) Ring buffer for live & dry-run liquidation events
│   │   ├── searcher.ts         # (M2) Searcher integration & lifecycle
│   │   └── telemetryBridge.ts  # (M2) NEW: Atomic telemetry file export daemon
│   └── index.ts                # (M2) Lifecycle integration
├── dashboard_cli/              # (M3) NEW: Standalone Dart CLI Package
│   ├── pubspec.yaml            # Package spec, dependencies (args, io, async, path)
│   ├── analysis_options.yaml   # Lints configuration
│   ├── bin/
│   │   └── dashboard.dart      # Thin entrypoint trampoline
│   ├── lib/
│   │   ├── dashboard_cli.dart  # Public library entrypoint
│   │   └── src/
│   │       ├── cli.dart        # Command argument parsing & execution runner
│   │       ├── lifecycle.dart  # Signal handling, raw mode, cursor restoration
│   │       ├── models/         # Telemetry data models & JSON deserializers
│   │       ├── poller/         # TelemetryReader, file polling, retry backoff
│   │       ├── renderer/       # ANSI dashboard renderer, formatters, spinner
│   │       └── terminal/       # Screen control, color palette, ANSI guards
│   └── test/                   # Comprehensive unit tests
├── tests/                      # Engine vitest tests
├── .state/                     # (M2) Runtime telemetry output (.gitignore'd)
│   └── telemetry.json
└── PROJECT.md                  # Master project document
```
