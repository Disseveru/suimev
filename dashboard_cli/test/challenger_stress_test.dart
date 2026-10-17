import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dashboard_cli/src/cli.dart';
import 'package:dashboard_cli/src/lifecycle.dart';
import 'package:dashboard_cli/src/models/models.dart';
import 'package:dashboard_cli/src/renderer/components/activity_feed.dart';
import 'package:dashboard_cli/src/renderer/components/financial_card.dart';
import 'package:dashboard_cli/src/renderer/components/obligation_card.dart';
import 'package:dashboard_cli/src/renderer/components/status_card.dart';
import 'package:dashboard_cli/src/renderer/components/watchlist_table.dart';
import 'package:dashboard_cli/src/renderer/dashboard_renderer.dart';
import 'package:dashboard_cli/src/renderer/formatters.dart';
import 'package:dashboard_cli/src/renderer/spinner.dart';
import 'package:dashboard_cli/src/terminal/ansi.dart';
import 'package:io/io.dart';
import 'package:test/test.dart';

void main() {
  group('Challenger Stress Test 1: ANSI & NO_COLOR Zero Escape Invariant', () {
    tearDown(() {
      Ansi.colorsEnabled = true;
    });

    test('All Ansi style helpers return plain unstyled text when colorsEnabled is false', () {
      Ansi.colorsEnabled = false;
      expect(Ansi.useAnsi, isFalse);

      expect(Ansi.boldGreen('Green'), equals('Green'));
      expect(Ansi.boldYellow('Yellow'), equals('Yellow'));
      expect(Ansi.boldRed('Red'), equals('Red'));
      expect(Ansi.boldCyan('Cyan'), equals('Cyan'));
      expect(Ansi.boldMagenta('Magenta'), equals('Magenta'));
      expect(Ansi.boldWhite('White'), equals('White'));
      expect(Ansi.dimGray('Gray'), equals('Gray'));
      expect(Ansi.strikeBadge('STRIKE'), equals('STRIKE'));
      expect(Ansi.cautionBadge('CAUTION'), equals('CAUTION'));
      expect(Ansi.healthyBadge('HEALTHY'), equals('HEALTHY'));
      expect(Ansi.style('Custom', '\x1B[31m'), equals('Custom'));

      // Verify zero escape characters in any helper output
      final helpers = [
        Ansi.boldGreen('test'),
        Ansi.boldYellow('test'),
        Ansi.boldRed('test'),
        Ansi.boldCyan('test'),
        Ansi.boldMagenta('test'),
        Ansi.boldWhite('test'),
        Ansi.dimGray('test'),
        Ansi.strikeBadge('test'),
        Ansi.cautionBadge('test'),
        Ansi.healthyBadge('test'),
      ];

      for (final text in helpers) {
        expect(text.contains('\x1B'), isFalse, reason: 'Helper leaked ANSI: $text');
      }
    });

    test('Full dashboard render emits zero ANSI escape sequences when colorsEnabled is false', () {
      Ansi.colorsEnabled = false;

      final payload = TelemetryPayload(
        timestamp: DateTime.now(),
        botStatus: 'ONLINE',
        operator: const OperatorState(
          address: '0x1234567890abcdef1234567890abcdef12345678',
          gasBalanceSui: 15.0,
          gasBalanceMist: '15000000000',
          gasBalanceUsd: 50.0,
        ),
        financials: const FinancialState(
          netRealizedPnlUsd: 2500.0,
          cumulativeGasSpentSui: 0.5,
          successfulLiquidations: 20,
          failedLiquidations: 1,
          totalSimulations: 150,
          successfulSimulations: 60,
        ),
        obligations: const ObligationSummary(
          totalMonitored: 1500,
          naviCount: 900,
          scallopCount: 600,
          immediateTargetsCount: 3,
          hotWatchlistCount: 5,
          safeCount: 1492,
        ),
        hotWatchlist: [
          const HotWatchlistItem(
            obligationId: '0x11112222333344445555',
            protocol: 'navi',
            borrower: '0xaaaa999988887777',
            healthFactor: 0.8500,
            totalDebtUsd: 50000.0,
            totalCollateralUsd: 45000.0,
            urgency: 'STRIKE',
          ),
          const HotWatchlistItem(
            obligationId: '0x22223333444455556666',
            protocol: 'scallop',
            borrower: '0xbbbb999988887777',
            healthFactor: 1.0050,
            totalDebtUsd: 20000.0,
            totalCollateralUsd: 20500.0,
            urgency: 'CRITICAL',
          ),
          const HotWatchlistItem(
            obligationId: '0x33334444555566667777',
            protocol: 'navi',
            borrower: '0xcccc999988887777',
            healthFactor: 1.0350,
            totalDebtUsd: 15000.0,
            totalCollateralUsd: 16000.0,
            urgency: 'HOT',
          ),
          const HotWatchlistItem(
            obligationId: '0x44445555666677778888',
            protocol: 'scallop',
            borrower: '0xdddd999988887777',
            healthFactor: 1.1500,
            totalDebtUsd: 1000.0,
            totalCollateralUsd: 2000.0,
            urgency: 'SAFE',
          ),
        ],
        recentLiquidations: [
          RecentLiquidationEvent(
            timestamp: DateTime.now(),
            protocol: 'scallop',
            borrower: '0xborrower1',
            debtRepaid: '5,000.00 USDC',
            collateralSeized: '2,500.00 SUI',
            netProfitUsd: 150.0,
            txDigest: '0xdigest123456789',
            txDigestLink: 'https://suiscan.xyz/mainnet/tx/0xdigest123456789',
          ),
          RecentLiquidationEvent(
            timestamp: DateTime.now().subtract(const Duration(minutes: 5)),
            protocol: 'navi',
            borrower: '0xborrower2',
            debtRepaid: '1,000.00 AUSD',
            collateralSeized: '1,200.00 SUI',
            netProfitUsd: -10.0, // negative profit
            txDigest: '0xdigest987654321',
            txDigestLink: 'https://suiscan.xyz/mainnet/tx/0xdigest987654321',
          ),
        ],
        mode: 'live',
        uptimeSeconds: 7200,
        rpcEndpoint: 'Alchemy Sui Mainnet',
      );

      final renderer = DashboardRenderer();
      final fullOutput = renderer.render(payload, statusWarning: 'Windows lock retry test');
      final loadingOutput = renderer.renderLoading(filePath: 'state.json', statusMessage: 'Connecting...');
      final helpOutput = renderer.renderHelp();

      expect(fullOutput.contains('\x1B['), isFalse, reason: 'Full render leaked ANSI code: $fullOutput');
      expect(loadingOutput.contains('\x1B['), isFalse, reason: 'Loading render leaked ANSI code');
      expect(helpOutput.contains('\x1B['), isFalse, reason: 'Help render leaked ANSI code');

      // Test individual components directly
      expect(StatusCard.render(payload).contains('\x1B['), isFalse);
      expect(FinancialCard.render(payload.operator, payload.financials).contains('\x1B['), isFalse);
      expect(ObligationCard.render(payload.obligations).contains('\x1B['), isFalse);
      expect(WatchlistTable.render(payload.hotWatchlist).contains('\x1B['), isFalse);
      expect(ActivityFeed.render(payload.recentLiquidations).contains('\x1B['), isFalse);
    });

    test('--no-color CLI flag suppresses all ANSI escape sequences in stdout', () async {
      final tempDir = await Directory.systemTemp.createTemp('challenger_nocolor_');
      try {
        final stateFile = File('${tempDir.path}/telemetry.json');
        await stateFile.writeAsString(jsonEncode(<String, dynamic>{
          'timestamp': DateTime.now().toIso8601String(),
          'botStatus': 'ONLINE',
          'operator': <String, dynamic>{
            'address': '0x1234567890abcdef',
            'gasTankBalanceSui': 5.0,
            'gasTankBalanceMist': '5000000000',
          },
          'financials': <String, dynamic>{
            'netRealizedPnlUsd': 50.0,
            'cumulativeGasSpentSui': 0.05,
            'successfulLiquidations': 1,
            'failedLiquidations': 0,
            'totalSimulations': 10,
          },
          'obligations': <String, dynamic>{
            'totalMonitored': 100,
            'naviCount': 50,
            'scallopCount': 50,
            'immediateTargetsCount': 1,
            'hotWatchlistCount': 2,
            'safeCount': 97,
          },
          'hotWatchlist': <Map<String, dynamic>>[
            <String, dynamic>{
              'obligationId': '0xabc',
              'protocol': 'navi',
              'borrower': '0x111',
              'healthFactor': 0.95,
              'totalDebtUsd': 1000.0,
              'totalCollateralUsd': 1100.0,
            }
          ],
          'recentLiquidations': <Map<String, dynamic>>[],
        }));

        final outBuffer = StringBuffer();
        final errBuffer = StringBuffer();

        final code = await runCli(
          ['--state-file', stateFile.path, '--once', '--no-color'],
          outSink: outBuffer,
          errSink: errBuffer,
        );

        expect(code, equals(ExitCode.success.code));
        final out = outBuffer.toString();
        expect(out.contains('\x1B['), isFalse, reason: '--no-color output contains ANSI escape: $out');
        expect(errBuffer.toString(), isEmpty);
      } finally {
        await tempDir.delete(recursive: true);
      }
    });
  });

  group('Challenger Stress Test 2: Health Factor Boundary Classification', () {
    test('Boundary HF values are strictly classified into correct risk tiers', () {
      // 1. Extreme low / default values
      final hfZero = HotWatchlistItem.fromJson(const <String, dynamic>{
        'obligationId': '0x1',
        'healthFactor': 0.0,
      });
      expect(hfZero.isStrikeZone, isTrue);
      expect(hfZero.isCaution, isFalse);
      expect(hfZero.isSafe, isFalse);
      expect(hfZero.urgency, equals('STRIKE'));

      // 2. High risk strike zone: 0.8500
      final hf85 = HotWatchlistItem.fromJson(const <String, dynamic>{
        'obligationId': '0x2',
        'healthFactor': 0.8500,
      });
      expect(hf85.isStrikeZone, isTrue);
      expect(hf85.isCaution, isFalse);
      expect(hf85.isSafe, isFalse);

      // 3. Just below strike boundary: 0.9999
      final hf9999 = HotWatchlistItem.fromJson(const <String, dynamic>{
        'obligationId': '0x3',
        'healthFactor': 0.9999,
      });
      expect(hf9999.isStrikeZone, isTrue);
      expect(hf9999.isCaution, isFalse);
      expect(hf9999.isSafe, isFalse);
      expect(hf9999.urgency, equals('STRIKE'));

      // 4. Exact strike boundary: 1.0000 -> Caution / Hot
      final hf10000 = HotWatchlistItem.fromJson(const <String, dynamic>{
        'obligationId': '0x4',
        'healthFactor': 1.0000,
      });
      expect(hf10000.isStrikeZone, isFalse);
      expect(hf10000.isCaution, isTrue);
      expect(hf10000.isSafe, isFalse);
      expect(hf10000.urgency, equals('CRITICAL')); // < 1.02 is CRITICAL

      // 5. Caution sub-tier: 1.0199 -> Critical (< 1.02)
      final hf10199 = HotWatchlistItem.fromJson(const <String, dynamic>{
        'obligationId': '0x5',
        'healthFactor': 1.0199,
      });
      expect(hf10199.isStrikeZone, isFalse);
      expect(hf10199.isCaution, isTrue);
      expect(hf10199.isSafe, isFalse);

      // 6. Caution sub-tier: 1.0200 -> Hot (>= 1.02)
      final hf10200 = HotWatchlistItem.fromJson(const <String, dynamic>{
        'obligationId': '0x6',
        'healthFactor': 1.0200,
      });
      expect(hf10200.isStrikeZone, isFalse);
      expect(hf10200.isCaution, isTrue);
      expect(hf10200.isSafe, isFalse);

      // 7. Near upper caution boundary: 1.0499
      final hf10499 = HotWatchlistItem.fromJson(const <String, dynamic>{
        'obligationId': '0x7',
        'healthFactor': 1.0499,
      });
      expect(hf10499.isStrikeZone, isFalse);
      expect(hf10499.isCaution, isTrue);
      expect(hf10499.isSafe, isFalse);

      // 8. Exact safe boundary: 1.0500 -> Safe
      final hf10500 = HotWatchlistItem.fromJson(const <String, dynamic>{
        'obligationId': '0x8',
        'healthFactor': 1.0500,
      });
      expect(hf10500.isStrikeZone, isFalse);
      expect(hf10500.isCaution, isFalse);
      expect(hf10500.isSafe, isTrue);

      // 9. Well into safe zone: 2.5000
      final hf250 = HotWatchlistItem.fromJson(const <String, dynamic>{
        'obligationId': '0x9',
        'healthFactor': 2.5000,
      });
      expect(hf250.isStrikeZone, isFalse);
      expect(hf250.isCaution, isFalse);
      expect(hf250.isSafe, isTrue);

      // 10. Large / astronomical HF: 10000.0
      final hfHuge = HotWatchlistItem.fromJson(const <String, dynamic>{
        'obligationId': '0x10',
        'healthFactor': 10000.0,
      });
      expect(hfHuge.isStrikeZone, isFalse);
      expect(hfHuge.isCaution, isFalse);
      expect(hfHuge.isSafe, isTrue);
    });

    test('WatchlistTable correctly renders labels and tier badges across boundaries', () {
      Ansi.colorsEnabled = false; // Plain text check for badge labels

      final items = [
        const HotWatchlistItem(
          obligationId: '0x1',
          protocol: 'navi',
          borrower: '0xborrower1',
          healthFactor: 0.8500,
          totalDebtUsd: 1000.0,
          totalCollateralUsd: 900.0,
          urgency: 'STRIKE',
        ),
        const HotWatchlistItem(
          obligationId: '0x2',
          protocol: 'scallop',
          borrower: '0xborrower2',
          healthFactor: 0.9999,
          totalDebtUsd: 1000.0,
          totalCollateralUsd: 1050.0,
          urgency: 'STRIKE',
        ),
        const HotWatchlistItem(
          obligationId: '0x3',
          protocol: 'navi',
          borrower: '0xborrower3',
          healthFactor: 1.0000,
          totalDebtUsd: 2000.0,
          totalCollateralUsd: 2100.0,
          urgency: 'CRITICAL',
        ),
        const HotWatchlistItem(
          obligationId: '0x4',
          protocol: 'scallop',
          borrower: '0xborrower4',
          healthFactor: 1.0250,
          totalDebtUsd: 3000.0,
          totalCollateralUsd: 3200.0,
          urgency: 'HOT',
        ),
        const HotWatchlistItem(
          obligationId: '0x5',
          protocol: 'navi',
          borrower: '0xborrower5',
          healthFactor: 1.0499,
          totalDebtUsd: 4000.0,
          totalCollateralUsd: 4300.0,
          urgency: 'HOT',
        ),
        const HotWatchlistItem(
          obligationId: '0x6',
          protocol: 'scallop',
          borrower: '0xborrower6',
          healthFactor: 1.0500,
          totalDebtUsd: 5000.0,
          totalCollateralUsd: 6000.0,
          urgency: 'SAFE',
        ),
      ];

      final output = WatchlistTable.render(items, maxItems: 10);

      // Verify specific boundary tags are present
      expect(output, contains('0.8500 [STRIKE]'));
      expect(output, contains('0.9999 [STRIKE]'));
      expect(output, contains('1.0000 [CRITICAL]'));
      expect(output, contains('1.0250 [HOT]'));
      expect(output, contains('1.0499 [HOT]'));
      expect(output, contains('1.0500 [SAFE]'));
    });

    test('ObligationCard handles zero counts vs positive counts across all tiers', () {
      Ansi.colorsEnabled = false;

      // All zero
      const zeroSummary = ObligationSummary(
        totalMonitored: 0,
        naviCount: 0,
        scallopCount: 0,
        immediateTargetsCount: 0,
        hotWatchlistCount: 0,
        safeCount: 0,
      );
      final zeroOutput = ObligationCard.render(zeroSummary);
      expect(zeroOutput, contains('0 accounts [None]'));
      expect(zeroOutput, contains('0 accounts [Healthy]'));

      // Active strikes present
      const strikeSummary = ObligationSummary(
        totalMonitored: 50,
        naviCount: 30,
        scallopCount: 20,
        immediateTargetsCount: 3,
        hotWatchlistCount: 5,
        safeCount: 42,
      );
      final strikeOutput = ObligationCard.render(strikeSummary);
      expect(strikeOutput, contains('3 ACCOUNTS READY TO LIQUIDATE'));
      expect(strikeOutput, contains('5 accounts [High-Frequency Surveillance]'));
      expect(strikeOutput, contains('42 accounts [Healthy]'));
    });
  });

  group('Challenger Stress Test 3: Terminal Lifecycle & Windows Signal Safety', () {
    test('raw sigterm on Windows produces SignalException confirming guard necessity', () async {
      if (Platform.isWindows) {
        final completer = Completer<Object>();
        final sub = ProcessSignal.sigterm.watch().listen(
          (_) {},
          onError: (Object err) {
            completer.complete(err);
          },
        );
        final err = await completer.future;
        await sub.cancel();
        expect(err.toString(), contains('Failed to listen for SIGTERM'));
      }
    });

    test('installSignalHandlers does not invoke sigterm on Windows and handles multiple calls', () {
      final lifecycle = TerminalLifecycle();
      int exitCount = 0;

      // Installing signal handlers must be clean and not throw
      expect(
        () => lifecycle.installSignalHandlers(() {
          exitCount++;
        }),
        returnsNormally,
      );

      // Idempotent restoreTerminal
      expect(() => lifecycle.restoreTerminal(), returnsNormally);
      expect(() => lifecycle.restoreTerminal(), returnsNormally);
      expect(() => lifecycle.restoreTerminal(), returnsNormally);

      expect(exitCount, equals(0));
    });

    test('TerminalLifecycle showCursor code is strictly standard VT100 \\x1B[?25h', () {
      expect(Ansi.showCursor, equals('\x1B[?25h'));
      expect(Ansi.hideCursor, equals('\x1B[?25l'));
    });

    test('configureInteractiveTerminal does not throw even when stdin is not a terminal', () {
      final lifecycle = TerminalLifecycle();
      expect(() => lifecycle.configureInteractiveTerminal(), returnsNormally);
      expect(() => lifecycle.restoreTerminal(), returnsNormally);
    });
  });

  group('Challenger Stress Test 4: Financial & Formatter Robustness', () {
    test('Formatters handle zero, large, negative, and fractional values without exception', () {
      // formatInteger
      expect(Formatters.formatInteger(0), equals('0'));
      expect(Formatters.formatInteger(999), equals('999'));
      expect(Formatters.formatInteger(1000), equals('1,000'));
      expect(Formatters.formatInteger(123456789), equals('123,456,789'));

      // formatUsd
      expect(Formatters.formatUsd(0.0), equals(r'$0.00'));
      expect(Formatters.formatUsd(1234.56), equals(r'$1,234.56'));
      expect(Formatters.formatUsd(-50.25), equals(r'-$50.25'));

      // formatSignedUsd
      expect(Formatters.formatSignedUsd(0.0), equals(r'+$0.00 USD'));
      expect(Formatters.formatSignedUsd(1500.50), equals(r'+$1,500.50 USD'));
      expect(Formatters.formatSignedUsd(-320.10), equals(r'-$320.10 USD'));

      // formatSui
      expect(Formatters.formatSui(0.0), equals('0.0000 SUI'));
      expect(Formatters.formatSui(14.82106), equals('14.8211 SUI')); // rounds to 4 decimals
      expect(Formatters.formatSui(1000.1234), equals('1,000.1234 SUI'));
    });

    test('FinancialCard formats negative net profit with red sign indicator', () {
      Ansi.colorsEnabled = false;

      const op = OperatorState(
        address: '0x1111',
        gasBalanceSui: 0.05, // critical gas
        gasBalanceMist: '50000000',
      );
      const fin = FinancialState(
        netRealizedPnlUsd: -125.75, // net loss
        cumulativeGasSpentSui: 1.5,
        successfulLiquidations: 0,
        failedLiquidations: 2,
        totalSimulations: 5,
      );

      final output = FinancialCard.render(op, fin);
      expect(output, contains(r'-$125.75 USD'));
      expect(output, contains('● CRITICAL (INSUFFICIENT)'));
      expect(output, contains('2 attempted (0 success, 2 failed)'));
    });

    test('StatusCard formats dryRun vs live execution modes correctly', () {
      Ansi.colorsEnabled = false;

      final livePayload = TelemetryPayload(
        timestamp: DateTime.now(),
        botStatus: 'ONLINE',
        operator: OperatorState.empty(),
        financials: FinancialState.empty(),
        obligations: ObligationSummary.empty(),
        hotWatchlist: [],
        recentLiquidations: [],
        mode: 'live',
      );
      expect(StatusCard.render(livePayload), contains('[MAINNET LIVE]'));

      final dryRunPayload = TelemetryPayload(
        timestamp: DateTime.now(),
        botStatus: 'ONLINE',
        operator: OperatorState.empty(),
        financials: FinancialState.empty(),
        obligations: ObligationSummary.empty(),
        hotWatchlist: [],
        recentLiquidations: [],
        mode: 'dryRun',
      );
      expect(StatusCard.render(dryRunPayload), contains('[SIMULATION / DRY-RUN]'));
    });
  });

  group('Challenger Stress Test 5: Braille Spinner Rotation & Frame Correctness', () {
    test('BrailleSpinner cycles smoothly through all 10 standard braille frames', () {
      final spinner = BrailleSpinner();
      const expectedFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

      expect(expectedFrames.length, equals(10));

      for (int cycle = 0; cycle < 3; cycle++) {
        for (final expected in expectedFrames) {
          final actual = spinner.nextFrame();
          expect(actual, equals(expected));
        }
      }
    });
  });
}
