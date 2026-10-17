import 'package:dashboard_cli/src/models/models.dart';
import 'package:dashboard_cli/src/renderer/dashboard_renderer.dart';
import 'package:dashboard_cli/src/terminal/ansi.dart';
import 'package:test/test.dart';

void main() {
  late DashboardRenderer renderer;

  setUp(() {
    renderer = DashboardRenderer();
    Ansi.colorsEnabled = true;
  });

  tearDown(() {
    Ansi.colorsEnabled = true;
  });

  TelemetryPayload createMockPayload({
    String status = 'ONLINE',
    double pnl = 1245.50,
    double gas = 14.8210,
    List<HotWatchlistItem>? watchlist,
    List<RecentLiquidationEvent>? events,
  }) {
    return TelemetryPayload(
      timestamp: DateTime.parse('2026-10-16T10:45:00.000Z'),
      botStatus: status,
      operator: OperatorState(
        address: '0x58c679e9596395dc553cb7b22a012a67e8876c12c759ae1b6d0d21650b299e58',
        gasBalanceSui: gas,
        gasBalanceMist: (gas * 1e9).toInt().toString(),
        gasBalanceUsd: 48.25,
      ),
      financials: FinancialState(
        netRealizedPnlUsd: pnl,
        cumulativeGasSpentSui: 0.1842,
        successfulLiquidations: 14,
        failedLiquidations: 0,
        totalSimulations: 86,
        successfulSimulations: 32,
      ),
      obligations: const ObligationSummary(
        totalMonitored: 1240,
        naviCount: 780,
        scallopCount: 460,
        immediateTargetsCount: 0,
        hotWatchlistCount: 2,
        safeCount: 1238,
      ),
      hotWatchlist: watchlist ??
          [
            const HotWatchlistItem(
              obligationId: '0x3b890123cdef456789abcdef0123456789abcdef',
              protocol: 'scallop',
              borrower: '0x9876543210fedcba9876543210fedcba98765432',
              healthFactor: 0.9842,
              totalDebtUsd: 5420.00,
              totalCollateralUsd: 5890.00,
              urgency: 'STRIKE',
            ),
            const HotWatchlistItem(
              obligationId: '0x8a3f8102a9b23c4d5e6f7a8b9c0d1e2f3a4b5c6d',
              protocol: 'navi',
              borrower: '0x1234567890abcdef1234567890abcdef12345678',
              healthFactor: 1.0145,
              totalDebtUsd: 12450.00,
              totalCollateralUsd: 13900.50,
              urgency: 'HOT',
            ),
          ],
      recentLiquidations: events ??
          [
            RecentLiquidationEvent(
              timestamp: DateTime.parse('2026-10-16T10:14:02.000Z'),
              protocol: 'navi',
              borrower: '0x3b89cdef',
              debtRepaid: '2,500.00 USDC',
              collateralSeized: '812.50 SUI',
              netProfitUsd: 135.20,
              txDigest: 'Gz3t8qK7L9vN2mP5wR8sT1uX4yZ6aB9cD2eF5gH8jK1',
              txDigestLink: 'https://suiscan.xyz/mainnet/tx/Gz3t8qK7L9vN2mP5wR8sT1uX4yZ6aB9cD2eF5gH8jK1',
            ),
          ],
      mode: 'live',
      uptimeSeconds: 3600,
      rpcEndpoint: 'Alchemy Dedicated Node',
    );
  }

  test('renders full dashboard containing all metric cards and controls', () {
    final payload = createMockPayload();
    final output = renderer.render(payload);
    final plainText = Ansi.strip(output);

    // Header checks
    expect(plainText, contains('SuiMEV LIQUIDATION MONITOR'));
    expect(plainText, contains('LIVE ENGINE ONLINE'));
    expect(plainText, contains('[MAINNET LIVE]'));
    expect(plainText, contains('Gateway: Alchemy Dedicated Node'));

    // Financial overview checks
    expect(plainText, contains('OPERATOR GAS TANK & REALIZED PnL'));
    expect(plainText, contains('14.8210 SUI'));
    expect(plainText, contains(r'+$1,245.50 USD'));
    expect(plainText, contains('● SUFFICIENT'));
    expect(plainText, contains('14 attempted (14 success, 0 failed)'));

    // Obligation queues checks
    expect(plainText, contains('OBLIGATION QUEUES (1,240 Total Monitored)'));
    expect(plainText, contains('Strike Zone (HF < 1.00)'));
    expect(plainText, contains('Hot Watchlist (1.00 <= HF < 1.05)'));
    expect(plainText, contains('Safe Accounts (HF >= 1.05)'));
    expect(plainText, contains('NAVI (780) | Scallop (460)'));

    // Hot accounts table checks
    expect(plainText, contains('HOT ACCOUNTS WATCHLIST'));
    expect(plainText, contains('PROTOCOL'));
    expect(plainText, contains('BORROWER'));
    expect(plainText, contains('HEALTH FACTOR'));
    expect(plainText, contains('SCALLOP'));
    expect(plainText, contains('0.9842 [STRIKE]'));
    expect(plainText, contains('NAVI'));
    expect(plainText, contains('1.0145 [CRITICAL]'));

    // Activity feed checks
    expect(plainText, contains('LIVE STRIKE ACTIVITY TICKER'));
    expect(plainText, contains('Seized 812.50 SUI for 2,500.00 USDC'));
    expect(plainText, contains(r'+$135.20 USD'));

    // Footer controls checks
    expect(plainText, contains('Controls: [Q] Quit   [R] Force Refresh   [C] Toggle Color Mode   [H] Help'));
  });

  test('compact mode omits activity feed to fit small displays', () {
    final payload = createMockPayload();
    final fullOutput = renderer.render(payload, compact: false);
    final compactOutput = renderer.render(payload, compact: true);

    expect(Ansi.strip(fullOutput), contains('LIVE STRIKE ACTIVITY TICKER'));
    expect(Ansi.strip(compactOutput), isNot(contains('LIVE STRIKE ACTIVITY TICKER')));
  });

  test('renders empty watchlist with friendly healthy message', () {
    final payload = createMockPayload(watchlist: []);
    final output = renderer.render(payload);
    final plainText = Ansi.strip(output);

    expect(plainText, contains('No obligations in strike zone (All accounts healthy HF >= 1.05)'));
  });

  test('renders empty activity feed with active monitoring message', () {
    final payload = createMockPayload(events: []);
    final output = renderer.render(payload);
    final plainText = Ansi.strip(output);

    expect(plainText, contains('Engine actively monitoring; no liquidations triggered yet.'));
  });

  test('renders friendly loading view with spinner and instructions', () {
    final loadingOutput = renderer.renderLoading(
      filePath: '../.state/telemetry.json',
      statusMessage: 'Waiting for engine snapshot...',
    );
    final plainText = Ansi.strip(loadingOutput);

    expect(plainText, contains('Connecting to SuiMEV liquidator engine...'));
    expect(plainText, contains('Target state file: ../.state/telemetry.json'));
    expect(plainText, contains('Status: Waiting for engine snapshot...'));
    expect(plainText, contains('(The dashboard will automatically refresh the instant the engine starts)'));
  });

  test('renders help overlay with keyboard shortcuts and risk tiers', () {
    final helpOutput = renderer.renderHelp();
    final plainText = Ansi.strip(helpOutput);

    expect(plainText, contains('DASHBOARD HELP & OPERATOR QUICK REFERENCE'));
    expect(plainText, contains('[Q] or [Ctrl+C]    Gracefully exit dashboard'));
    expect(plainText, contains('[R]                Force immediate file read & UI refresh'));
    expect(plainText, contains('[C]                Toggle ANSI color styling on/off'));
    expect(plainText, contains('[H] or [?]         Toggle this help screen on/off'));
    expect(plainText, contains('RED [STRIKE]'));
    expect(plainText, contains('YELLOW [HOT]'));
    expect(plainText, contains('GREEN [SAFE]'));
  });

  test('strips ANSI escape codes when colors are disabled', () {
    Ansi.colorsEnabled = false;
    final styledText = Ansi.boldGreen('TEST_TEXT');
    expect(styledText, equals('TEST_TEXT'));

    final payload = createMockPayload();
    final rendered = renderer.render(payload);
    // When colorsEnabled is false, output should have no escape characters
    expect(rendered.contains('\x1B['), isFalse);
  });

  test('visualWidth accurately measures column widths ignoring ANSI escapes', () {
    const rawText = 'HELLO WORLD';
    final coloredText = Ansi.boldRed(rawText);

    expect(Ansi.visualWidth(rawText), equals(11));
    expect(Ansi.visualWidth(coloredText), equals(11));
    expect(Ansi.padRight(coloredText, 15).length, greaterThanOrEqualTo(15));
    expect(Ansi.visualWidth(Ansi.padRight(coloredText, 15)), equals(15));
  });
}
