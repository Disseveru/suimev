import 'dart:convert';
import 'dart:io';

import 'package:dashboard_cli/src/cli.dart';
import 'package:dashboard_cli/src/models/financial_state.dart';
import 'package:dashboard_cli/src/models/hot_watchlist_item.dart';
import 'package:dashboard_cli/src/models/obligation_summary.dart';
import 'package:dashboard_cli/src/models/operator_state.dart';
import 'package:dashboard_cli/src/models/recent_liquidation_event.dart';
import 'package:dashboard_cli/src/models/telemetry_payload.dart';
import 'package:dashboard_cli/src/poller/telemetry_reader.dart';
import 'package:dashboard_cli/src/renderer/dashboard_renderer.dart';
import 'package:dashboard_cli/src/renderer/formatters.dart';
import 'package:dashboard_cli/src/terminal/ansi.dart';
import 'package:io/io.dart';
import 'package:test/test.dart';

void main() {
  group('Adversarial Stress Tests - CLI Argument Parsing & Exit Codes', () {
    test('refresh-interval = 0 returns exit code 64 with stderr usage', () async {
      final outSink = StringBuffer();
      final errSink = StringBuffer();
      final code = await runCli(
        ['--refresh-interval', '0'],
        outSink: outSink,
        errSink: errSink,
      );

      expect(code, equals(ExitCode.usage.code));
      expect(outSink.toString(), isEmpty);
      expect(errSink.toString(), contains('Refresh interval cannot be less than 100ms'));
      expect(errSink.toString(), contains('Usage: dashboard [options]'));
    });

    test('refresh-interval = -50 returns exit code 64 with stderr usage', () async {
      final outSink = StringBuffer();
      final errSink = StringBuffer();
      final code = await runCli(
        ['-i', '-50'],
        outSink: outSink,
        errSink: errSink,
      );

      expect(code, equals(ExitCode.usage.code));
      expect(outSink.toString(), isEmpty);
      expect(errSink.toString(), contains('Refresh interval cannot be less than 100ms'));
    });

    test('refresh-interval = 99 (boundary below 100) returns exit code 64', () async {
      final outSink = StringBuffer();
      final errSink = StringBuffer();
      final code = await runCli(
        ['--refresh-interval', '99'],
        outSink: outSink,
        errSink: errSink,
      );

      expect(code, equals(ExitCode.usage.code));
      expect(errSink.toString(), contains('Refresh interval cannot be less than 100ms'));
    });

    test('refresh-interval = 100 (exact boundary) parses successfully', () async {
      final parser = buildArgParser();
      final results = parser.parse(['--refresh-interval', '100']);
      expect(results.option('refresh-interval'), equals('100'));
      final interval = int.parse(results.option('refresh-interval')!);
      expect(interval >= 100, isTrue);
    });

    test('refresh-interval floating point "100.5" returns exit code 64', () async {
      final errSink = StringBuffer();
      final code = await runCli(
        ['--refresh-interval', '100.5'],
        errSink: errSink,
      );
      expect(code, equals(ExitCode.usage.code));
      expect(errSink.toString(), contains('Invalid --refresh-interval'));
    });

    test('refresh-interval alphabetic "fast" returns exit code 64', () async {
      final errSink = StringBuffer();
      final code = await runCli(
        ['-i', 'fast'],
        errSink: errSink,
      );
      expect(code, equals(ExitCode.usage.code));
      expect(errSink.toString(), contains('Invalid --refresh-interval'));
    });

    test('unknown option "--foo" returns exit code 64 with usage on stderr', () async {
      final outSink = StringBuffer();
      final errSink = StringBuffer();
      final code = await runCli(
        ['--foo'],
        outSink: outSink,
        errSink: errSink,
      );
      expect(code, equals(ExitCode.usage.code));
      expect(outSink.toString(), isEmpty);
      expect(errSink.toString(), contains('Could not find an option named "--foo"'));
      expect(errSink.toString(), contains('Usage: dashboard [options]'));
    });

    test('unknown abbreviation "-z" returns exit code 64 with usage on stderr', () async {
      final errSink = StringBuffer();
      final code = await runCli(['-z'], errSink: errSink);
      expect(code, equals(ExitCode.usage.code));
      expect(errSink.toString(), contains('Could not find an option or flag "-z"'));
    });

    test('--help does NOT write to stderr and returns exit code 0', () async {
      final outSink = StringBuffer();
      final errSink = StringBuffer();
      final code = await runCli(['--help'], outSink: outSink, errSink: errSink);
      expect(code, equals(ExitCode.success.code));
      expect(errSink.toString(), isEmpty);
      expect(outSink.toString(), contains('Usage: dashboard [options]'));
    });

    test('--version does NOT write to stderr and returns exit code 0', () async {
      final outSink = StringBuffer();
      final errSink = StringBuffer();
      final code = await runCli(['--version'], outSink: outSink, errSink: errSink);
      expect(code, equals(ExitCode.success.code));
      expect(errSink.toString(), isEmpty);
      expect(outSink.toString(), equals('dashboard_cli version 1.0.0\n'));
    });
  });

  group('Adversarial Stress Tests - File Poller & Reader Edge Cases', () {
    late Directory tempDir;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('adv_poller_test_');
    });

    tearDown(() async {
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    test('poller on non-existent file returns loading status without throwing', () async {
      final missingFile = File('${tempDir.path}/nonexistent.json');
      final reader = TelemetryReader(file: missingFile);

      final result = await reader.readLatest();
      expect(result.isLoading, isTrue);
      expect(result.payload, isNull);
      expect(result.statusMessage, contains('Telemetry file not found'));
    });

    test('poller on empty file (0 bytes) returns loading status without crashing', () async {
      final emptyFile = File('${tempDir.path}/empty.json');
      await emptyFile.writeAsString('');

      final reader = TelemetryReader(
        file: emptyFile,
        maxRetries: 1,
        retryDelay: const Duration(milliseconds: 5),
      );

      final result = await reader.readLatest();
      expect(result.isLoading, isTrue);
      expect(result.payload, isNull);
      expect(result.statusMessage, contains('Waiting for atomic snapshot flush'));
    });

    test('poller on whitespace-only file returns loading status without crashing', () async {
      final wsFile = File('${tempDir.path}/whitespace.json');
      await wsFile.writeAsString('   \n\t  \r\n   ');

      final reader = TelemetryReader(
        file: wsFile,
        maxRetries: 1,
        retryDelay: const Duration(milliseconds: 5),
      );

      final result = await reader.readLatest();
      expect(result.isLoading, isTrue);
      expect(result.payload, isNull);
    });

    test('poller on malformed JSON returns loading status without crashing', () async {
      final malformedFile = File('${tempDir.path}/malformed.json');
      await malformedFile.writeAsString('{ "timestamp": "2026-10-16", "botStatus": ');

      final reader = TelemetryReader(
        file: malformedFile,
        maxRetries: 1,
        retryDelay: const Duration(milliseconds: 5),
      );

      final result = await reader.readLatest();
      expect(result.isLoading, isTrue);
      expect(result.payload, isNull);
    });

    test('poller on JSON array (expected Map) returns loading status without crashing', () async {
      final arrayFile = File('${tempDir.path}/array.json');
      await arrayFile.writeAsString('[1, 2, 3]');

      final reader = TelemetryReader(
        file: arrayFile,
        maxRetries: 1,
        retryDelay: const Duration(milliseconds: 5),
      );

      final result = await reader.readLatest();
      expect(result.isLoading, isTrue);
      expect(result.payload, isNull);
    });

    test('poller on JSON primitive scalar returns loading status without crashing', () async {
      final scalarFile = File('${tempDir.path}/scalar.json');
      await scalarFile.writeAsString('"just a string"');

      final reader = TelemetryReader(
        file: scalarFile,
        maxRetries: 1,
        retryDelay: const Duration(milliseconds: 5),
      );

      final result = await reader.readLatest();
      expect(result.isLoading, isTrue);
      expect(result.payload, isNull);
    });

    test('poller retains cached state with warning if file is subsequently corrupted', () async {
      final stateFile = File('${tempDir.path}/live_state.json');
      final validPayload = {
        'timestamp': DateTime.now().toIso8601String(),
        'botStatus': 'ONLINE',
        'operator': {'address': '0x123', 'gasTankBalanceSui': 5.0},
        'financials': {'netRealizedPnlUsd': 25.0},
        'obligations': {'totalMonitored': 10},
        'hotWatchlist': <Map<String, dynamic>>[],
        'recentLiquidations': <Map<String, dynamic>>[],
      };

      await stateFile.writeAsString(jsonEncode(validPayload));
      final reader = TelemetryReader(
        file: stateFile,
        maxRetries: 2,
        retryDelay: const Duration(milliseconds: 5),
      );

      final initial = await reader.readLatest();
      expect(initial.isLoading, isFalse);
      expect(initial.payload!.botStatus, equals('ONLINE'));
      expect(initial.fromCache, isFalse);

      // Now corrupt the file (simulate incomplete write)
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await stateFile.writeAsString('{"incomplete": true, ');

      final corruptedResult = await reader.readLatest(force: true);
      expect(corruptedResult.isLoading, isFalse);
      expect(corruptedResult.fromCache, isTrue);
      expect(corruptedResult.payload, isNotNull);
      expect(corruptedResult.payload!.botStatus, equals('ONLINE'));
      expect(corruptedResult.statusMessage, contains('Partial snapshot write detected'));
    });

    test('rapid concurrent reads and writes handle file updates without unhandled crash', () async {
      final stateFile = File('${tempDir.path}/rapid_state.json');
      final reader = TelemetryReader(
        file: stateFile,
        maxRetries: 5,
        retryDelay: const Duration(milliseconds: 10),
      );

      // Write 25 rapid atomic-style updates
      for (int i = 0; i < 25; i++) {
        final payload = {
          'timestamp': DateTime.now().toIso8601String(),
          'botStatus': i % 2 == 0 ? 'ONLINE' : 'PAUSED',
          'operator': {'address': '0x123', 'gasTankBalanceSui': 1.0 * i},
          'financials': {'netRealizedPnlUsd': 10.0 * i},
          'obligations': {'totalMonitored': i},
          'hotWatchlist': <Map<String, dynamic>>[],
          'recentLiquidations': <Map<String, dynamic>>[],
        };
        await stateFile.writeAsString(jsonEncode(payload));

        final res = await reader.readLatest(force: true);
        expect(res.payload, isNotNull);
        expect(res.isLoading, isFalse);
      }
    });
  });

  group('Adversarial Stress Tests - Boundary Values & Defensive Deserialization', () {
    test('handles empty JSON object {} gracefully with default fallback values', () {
      final payload = TelemetryPayload.fromJson({});
      expect(payload.botStatus, equals('ONLINE'));
      expect(payload.operator.address, equals('0x0000...0000'));
      expect(payload.operator.gasBalanceSui, equals(0.0));
      expect(payload.financials.netRealizedPnlUsd, equals(0.0));
      expect(payload.obligations.totalMonitored, equals(0));
      expect(payload.hotWatchlist, isEmpty);
      expect(payload.recentLiquidations, isEmpty);
    });

    test('handles null field values in top-level JSON', () {
      final json = <String, dynamic>{
        'timestamp': null,
        'botStatus': null,
        'operator': null,
        'financials': null,
        'obligations': null,
        'hotWatchlist': null,
        'recentLiquidations': null,
      };

      final payload = TelemetryPayload.fromJson(json);
      expect(payload.botStatus, equals('ONLINE'));
      expect(payload.operator.gasBalanceSui, equals(0.0));
      expect(payload.financials.netRealizedPnlUsd, equals(0.0));
      expect(payload.obligations.totalMonitored, equals(0));
      expect(payload.hotWatchlist, isEmpty);
      expect(payload.recentLiquidations, isEmpty);
    });

    test('handles extreme financial values (trillions, negative PnL)', () {
      final json = <String, dynamic>{
        'netRealizedPnlUsd': -999999999999.99,
        'cumulativeGasSpentSui': 123456789.1234,
        'successfulLiquidations': 1000000,
        'failedLiquidations': 50000,
        'totalSimulations': 50000000,
      };

      final fin = FinancialState.fromJson(json);
      expect(fin.netRealizedPnlUsd, equals(-999999999999.99));
      expect(fin.formattedPnl, contains(r'-$999999999999.99 USD'));
      expect(fin.winRate, closeTo(95.238, 0.01));
    });

    test('handles zero total liquidations winRate without division by zero crash', () {
      const fin = FinancialState(
        netRealizedPnlUsd: 0.0,
        cumulativeGasSpentSui: 0.0,
        successfulLiquidations: 0,
        failedLiquidations: 0,
        totalSimulations: 0,
      );
      expect(fin.winRate, equals(100.0));
      expect(fin.winRateFormatted, equals('100.0%'));
    });

    test('handles extreme health factors in HotWatchlistItem', () {
      final hfZero = HotWatchlistItem.fromJson({
        'healthFactor': 0.0,
        'totalDebtUsd': 1000.0,
        'totalCollateralUsd': 0.0,
      });
      expect(hfZero.isStrikeZone, isTrue);
      expect(hfZero.isCaution, isFalse);
      expect(hfZero.isSafe, isFalse);
      expect(hfZero.urgency, equals('STRIKE'));

      final hfNearStrike = HotWatchlistItem.fromJson({
        'healthFactor': 1.0150,
      });
      expect(hfNearStrike.isStrikeZone, isFalse);
      expect(hfNearStrike.isCaution, isTrue);
      expect(hfNearStrike.isSafe, isFalse);
      expect(hfNearStrike.urgency, equals('CRITICAL'));

      final hfHot = HotWatchlistItem.fromJson({
        'healthFactor': 1.0350,
      });
      expect(hfHot.isStrikeZone, isFalse);
      expect(hfHot.isCaution, isTrue);
      expect(hfHot.urgency, equals('HOT'));

      final hfSafe = HotWatchlistItem.fromJson({
        'healthFactor': 2.5000,
      });
      expect(hfSafe.isStrikeZone, isFalse);
      expect(hfSafe.isCaution, isFalse);
      expect(hfSafe.isSafe, isTrue);
    });

    test('handles non-map items in hotWatchlist and recentLiquidations gracefully', () {
      final json = <String, dynamic>{
        'timestamp': DateTime.now().toIso8601String(),
        'botStatus': 'ONLINE',
        'operator': {'address': '0x123', 'gasTankBalanceSui': 1.0},
        'financials': {'netRealizedPnlUsd': 10.0},
        'obligations': {'totalMonitored': 1},
        'hotWatchlist': ['not a map', 123, null],
        'recentLiquidations': [false, 'invalid', null],
      };

      final payload = TelemetryPayload.fromJson(json);
      expect(payload.hotWatchlist, isEmpty);
      expect(payload.recentLiquidations, isEmpty);
    });

    test('handles operator shortAddress edge cases (short vs long address)', () {
      const shortAddrOp = OperatorState(
        address: '0x123',
        gasBalanceSui: 1.0,
        gasBalanceMist: '1000000000',
      );
      expect(shortAddrOp.shortAddress, equals('0x123'));

      const longAddrOp = OperatorState(
        address: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        gasBalanceSui: 1.0,
        gasBalanceMist: '1000000000',
      );
      expect(longAddrOp.shortAddress, equals('0x1234...cdef'));
    });

    test('handles liquidation event formatting with missing symbols / alternative keys', () {
      final event = RecentLiquidationEvent.fromJson({
        'timestamp': '2026-10-16T12:00:00Z',
        'protocol': 'navi',
        'borrower': '0xabc',
        'debtRepaidAmount': 500,
        'debtRepaidSymbol': 'USDC',
        'collateralSeizedAmount': 250,
        'collateralSeizedSymbol': 'SUI',
        'netProfitUsd': 15.5,
        'txDigest': '5cZ8Xyz',
      });

      expect(event.debtRepaid, equals('500 USDC'));
      expect(event.collateralSeized, equals('250 SUI'));
      expect(event.txDigestLink, equals('https://suiscan.xyz/mainnet/tx/5cZ8Xyz'));
      expect(event.formattedProfit, equals(r'+$15.50 USD'));
    });
  });

  group('Adversarial Stress Tests - Formatters & Visual Width Robustness', () {
    test('formatInteger correctly formats 0, small, and multi-thousand values', () {
      expect(Formatters.formatInteger(0), equals('0'));
      expect(Formatters.formatInteger(5), equals('5'));
      expect(Formatters.formatInteger(999), equals('999'));
      expect(Formatters.formatInteger(1000), equals('1,000'));
      expect(Formatters.formatInteger(1234567), equals('1,234,567'));
      expect(Formatters.formatInteger(1000000000), equals('1,000,000,000'));
    });

    test('formatUsd and formatSignedUsd handle zero, positive, and negative amounts', () {
      expect(Formatters.formatUsd(0.0), equals(r'$0.00'));
      expect(Formatters.formatUsd(1250.5), equals(r'$1,250.50'));
      expect(Formatters.formatUsd(-5420.25), equals(r'-$5,420.25'));

      expect(Formatters.formatSignedUsd(0.0), equals(r'+$0.00 USD'));
      expect(Formatters.formatSignedUsd(100.0), equals(r'+$100.00 USD'));
      expect(Formatters.formatSignedUsd(-42.15), equals(r'-$42.15 USD'));
    });

    test('formatSui handles standard and zero amounts', () {
      expect(Formatters.formatSui(0.0), equals('0.0000 SUI'));
      expect(Formatters.formatSui(14.8523), equals('14.8523 SUI'));
      expect(Formatters.formatSui(12450.1234), equals('12,450.1234 SUI'));
    });

    test('timeAgo handles recent, seconds, minutes, hours, and days ago', () {
      final now = DateTime.now();
      expect(Formatters.timeAgo(now), equals('just now'));
      expect(Formatters.timeAgo(now.subtract(const Duration(seconds: 30))), equals('30s ago'));
      expect(Formatters.timeAgo(now.subtract(const Duration(minutes: 5))), equals('5m ago'));
      expect(Formatters.timeAgo(now.subtract(const Duration(hours: 3))), equals('3h ago'));
      expect(Formatters.timeAgo(now.subtract(const Duration(days: 2))), equals('2d ago'));
    });

    test('visualWidth and strip correctly ignore complex ANSI escape sequences', () {
      const raw = 'Hello World';
      const styled = '\x1B[1m\x1B[92mHello World\x1B[0m';
      expect(Ansi.strip(styled), equals(raw));
      expect(Ansi.visualWidth(styled), equals(11));

      final padded = Ansi.padRight(styled, 20);
      expect(Ansi.visualWidth(padded), equals(20));
      expect(Ansi.strip(padded), equals('Hello World         '));
    });

    test('passing directory as state-file returns loading state without unhandled crash', () async {
      final reader = TelemetryReader(
        file: File(Directory.current.path),
        maxRetries: 1,
        retryDelay: const Duration(milliseconds: 5),
      );
      final result = await reader.readLatest();
      expect(result.isLoading, isTrue);
      expect(result.payload, isNull);
    });

    test('refresh-interval overflowing 64-bit integer returns exit code 64', () async {
      final errSink = StringBuffer();
      final code = await runCli(
        ['-i', '99999999999999999999999999999999999999999999999999'],
        errSink: errSink,
      );
      expect(code, equals(ExitCode.usage.code));
      expect(errSink.toString(), contains('Error: Invalid --refresh-interval'));
    });

    test('handles scientific notation in telemetry numbers', () {
      final json = <String, dynamic>{
        'timestamp': '2026-10-16T12:00:00Z',
        'botStatus': 'ONLINE',
        'operator': {
          'gasTankBalanceSui': 1.5e3,
          'gasBalanceMist': '1500000000000',
        },
        'financials': {
          'netRealizedPnlUsd': 2.5e4,
          'cumulativeGasSpentSui': 1.2e-2,
        },
        'obligations': {
          'totalMonitored': 500,
        },
        'hotWatchlist': [
          {
            'healthFactor': 1.015,
            'totalDebtUsd': 1.2e5,
            'totalCollateralUsd': 1.3e5,
          }
        ],
      };

      final payload = TelemetryPayload.fromJson(json);
      expect(payload.operator.gasBalanceSui, equals(1500.0));
      expect(payload.financials.netRealizedPnlUsd, equals(25000.0));
      expect(payload.financials.cumulativeGasSpentSui, equals(0.012));
      expect(payload.hotWatchlist.first.totalDebtUsd, equals(120000.0));
      expect(payload.hotWatchlist.first.totalCollateralUsd, equals(130000.0));
    });

    test('--no-color outputs pure text without ANSI escape sequences in --once mode', () async {
      final outSink = StringBuffer();
      final code = await runCli(
        ['--state-file', 'nonexistent_test.json', '--once', '--no-color'],
        outSink: outSink,
      );
      expect(code, equals(ExitCode.success.code));
      final out = outSink.toString();
      expect(out, isNot(contains('\x1B[')));
      expect(out, contains('Connecting to SuiMEV liquidator engine...'));
    });

  });

  group('Adversarial Stress Tests - Full Renderer Layout Stress', () {
    test('renders extreme telemetry payload without unhandled exception', () {
      final renderer = DashboardRenderer();
      final payload = TelemetryPayload(
        timestamp: DateTime.now(),
        botStatus: 'ONLINE',
        operator: const OperatorState(
          address: '0x9999999999999999999999999999999999999999999999999999999999999999',
          gasBalanceSui: 9999999.9999,
          gasBalanceMist: '9999999999900000',
          gasBalanceUsd: 12345678.90,
          isSufficient: true,
        ),
        financials: const FinancialState(
          netRealizedPnlUsd: 1234567.89,
          cumulativeGasSpentSui: 543.2100,
          successfulLiquidations: 50,
          failedLiquidations: 2,
          totalSimulations: 10000,
          successfulSimulations: 9500,
        ),
        obligations: const ObligationSummary(
          totalMonitored: 50000,
          naviCount: 30000,
          scallopCount: 20000,
          immediateTargetsCount: 5,
          hotWatchlistCount: 20,
          safeCount: 49975,
        ),
        hotWatchlist: List.generate(
          10,
          (i) => HotWatchlistItem(
            obligationId: '0xObligation$i',
            protocol: i % 2 == 0 ? 'navi' : 'scallop',
            borrower: '0xBorrower$i',
            healthFactor: 0.98 + (i * 0.01),
            totalDebtUsd: 10000.0 * (i + 1),
            totalCollateralUsd: 10500.0 * (i + 1),
            urgency: i == 0 ? 'STRIKE' : 'HOT',
          ),
        ),
        recentLiquidations: List.generate(
          5,
          (i) => RecentLiquidationEvent(
            timestamp: DateTime.now().subtract(Duration(minutes: i * 10)),
            protocol: 'navi',
            borrower: '0xBorrower$i',
            debtRepaid: '5,000 USDC',
            collateralSeized: '2,500 SUI',
            netProfitUsd: 50.0 * (i + 1),
            gasCostSui: 0.05,
            txDigest: '0xDigest$i',
            txDigestLink: 'https://suiscan.xyz/mainnet/tx/0xDigest$i',
          ),
        ),
      );

      final fullOutput = renderer.render(payload, compact: false, statusWarning: 'Test warning lock');
      expect(fullOutput, contains('SuiMEV LIQUIDATION MONITOR'));
      expect(fullOutput, contains('OPERATOR GAS TANK & REALIZED PnL'));
      expect(fullOutput, contains('OBLIGATION QUEUES'));
      expect(fullOutput, contains('HOT ACCOUNTS WATCHLIST'));
      expect(fullOutput, contains('LIVE STRIKE ACTIVITY TICKER'));
      expect(fullOutput, contains('Test warning lock'));

      final compactOutput = renderer.render(payload, compact: true);
      expect(compactOutput, contains('HOT ACCOUNTS WATCHLIST'));
      expect(compactOutput, isNot(contains('LIVE STRIKE ACTIVITY TICKER')));
    });

    test('renders empty payload without crashing', () {
      final renderer = DashboardRenderer();
      final emptyPayload = TelemetryPayload.empty();

      final output = renderer.render(emptyPayload);
      expect(output, contains('OFFLINE'));
      expect(output, contains('0 Total Monitored'));
      expect(output, contains('No obligations in strike zone'));
      expect(output, contains('no liquidations triggered yet'));
    });
  });

  group('Adversarial Stress Tests - CLI Process Execution (dart run bin/dashboard.dart)', () {
    test('Process run --help returns exit code 0 and usage on stdout', () async {
      final result = await Process.run(
        'dart',
        ['run', 'bin/dashboard.dart', '--help'],
      );
      expect(result.exitCode, equals(0));
      expect(result.stdout.toString(), contains('SuiMEV Liquidator Bot - Terminal Live Feed Dashboard'));
      expect(result.stderr.toString(), isEmpty);
    });

    test('Process run --version returns exit code 0 and version on stdout', () async {
      final result = await Process.run(
        'dart',
        ['run', 'bin/dashboard.dart', '--version'],
      );
      expect(result.exitCode, equals(0));
      expect(result.stdout.toString(), contains('dashboard_cli version 1.0.0'));
      expect(result.stderr.toString(), isEmpty);
    });

    test('Process run with invalid -i 20 returns exit code 64 and usage on stderr', () async {
      final result = await Process.run(
        'dart',
        ['run', 'bin/dashboard.dart', '-i', '20'],
      );
      expect(result.exitCode, equals(64));
      expect(result.stderr.toString(), contains('Error: Invalid --refresh-interval'));
      expect(result.stderr.toString(), contains('Refresh interval cannot be less than 100ms'));
      expect(result.stderr.toString(), contains('Usage: dashboard [options]'));
    });

    test('Process run with missing state file in --once mode exits 0 with friendly message', () async {
      final result = await Process.run(
        'dart',
        ['run', 'bin/dashboard.dart', '--state-file', 'definitely_nonexistent_file.json', '--once'],
      );
      expect(result.exitCode, equals(0));
      expect(result.stdout.toString(), contains('Connecting to SuiMEV liquidator engine...'));
      expect(result.stdout.toString(), contains('definitely_nonexistent_file.json'));
    });
  });
}
