import 'dart:convert';
import 'dart:io';

import 'package:dashboard_cli/src/cli.dart';
import 'package:io/io.dart';
import 'package:test/test.dart';

void main() {
  late Directory tempDir;
  late File sampleStateFile;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('cli_args_test_');
    sampleStateFile = File('${tempDir.path}/telemetry.json');
  });

  tearDown(() async {
    if (await tempDir.exists()) {
      await tempDir.delete(recursive: true);
    }
  });

  Map<String, dynamic> samplePayload() => {
        'timestamp': DateTime.now().toIso8601String(),
        'botStatus': 'ONLINE',
        'operator': {
          'address': '0x1234567890abcdef',
          'gasTankBalanceSui': 10.0,
          'gasTankBalanceMist': '10000000000',
        },
        'financials': {
          'netRealizedPnlUsd': 100.0,
          'cumulativeGasSpentSui': 0.1,
          'successfulLiquidations': 2,
          'failedLiquidations': 0,
          'totalSimulations': 20,
        },
        'obligations': {
          'totalMonitored': 500,
          'naviCount': 300,
          'scallopCount': 200,
          'immediateTargetsCount': 0,
          'hotWatchlistCount': 1,
          'safeCount': 499,
        },
        'hotWatchlist': [
          {
            'obligationId': '0xabcd',
            'protocol': 'navi',
            'borrower': '0x1111',
            'healthFactor': 1.025,
            'totalDebtUsd': 5000.0,
            'totalCollateralUsd': 6000.0,
            'urgency': 'HOT',
          }
        ],
        'recentLiquidations': <Map<String, dynamic>>[],
      };

  test('--help prints usage to stdout and exits with code 0', () async {
    final outBuffer = StringBuffer();
    final errBuffer = StringBuffer();

    final code = await runCli(
      ['--help'],
      outSink: outBuffer,
      errSink: errBuffer,
    );

    expect(code, equals(ExitCode.success.code));
    final out = outBuffer.toString();
    expect(out, contains('SuiMEV Liquidator Bot - Terminal Live Feed Dashboard'));
    expect(out, contains('--state-file'));
    expect(out, contains('--refresh-interval'));
    expect(out, contains('--no-color'));
    expect(out, contains('--compact'));
    expect(out, contains('--once'));
    expect(out, contains('Interactive Keys:'));
    expect(errBuffer.toString(), isEmpty);
  });

  test('-h abbreviation works for help', () async {
    final outBuffer = StringBuffer();
    final code = await runCli(['-h'], outSink: outBuffer);
    expect(code, equals(ExitCode.success.code));
    expect(outBuffer.toString(), contains('Usage: dashboard [options]'));
  });

  test('--version prints version to stdout and exits with code 0', () async {
    final outBuffer = StringBuffer();
    final errBuffer = StringBuffer();

    final code = await runCli(
      ['--version'],
      outSink: outBuffer,
      errSink: errBuffer,
    );

    expect(code, equals(ExitCode.success.code));
    expect(outBuffer.toString(), contains('dashboard_cli version $cliVersion'));
    expect(errBuffer.toString(), isEmpty);
  });

  test('invalid refresh interval throws error and writes to stderr with exit code 64', () async {
    final outBuffer = StringBuffer();
    final errBuffer = StringBuffer();

    final code = await runCli(
      ['--refresh-interval', '50'], // less than 100ms
      outSink: outBuffer,
      errSink: errBuffer,
    );

    expect(code, equals(ExitCode.usage.code));
    expect(outBuffer.toString(), isEmpty);
    final err = errBuffer.toString();
    expect(err, contains('Error: Invalid --refresh-interval'));
    expect(err, contains('Refresh interval cannot be less than 100ms'));
    expect(err, contains('Usage: dashboard [options]'));
  });

  test('non-integer refresh interval returns exit code 64', () async {
    final errBuffer = StringBuffer();
    final code = await runCli(['-i', 'not-a-number'], errSink: errBuffer);
    expect(code, equals(ExitCode.usage.code));
    expect(errBuffer.toString(), contains('Error: Invalid --refresh-interval'));
  });

  test('unknown option returns exit code 64 with usage written to stderr', () async {
    final outBuffer = StringBuffer();
    final errBuffer = StringBuffer();

    final code = await runCli(
      ['--nonexistent-flag'],
      outSink: outBuffer,
      errSink: errBuffer,
    );

    expect(code, equals(ExitCode.usage.code));
    expect(outBuffer.toString(), isEmpty);
    final err = errBuffer.toString();
    expect(err, contains('Error: Could not find an option named "--nonexistent-flag"'));
    expect(err, contains('Usage: dashboard [options]'));
  });

  test('--once flag renders single snapshot to stdout and exits cleanly', () async {
    await sampleStateFile.writeAsString(jsonEncode(samplePayload()));

    final outBuffer = StringBuffer();
    final errBuffer = StringBuffer();

    final code = await runCli(
      ['--state-file', sampleStateFile.path, '--once', '--no-color'],
      outSink: outBuffer,
      errSink: errBuffer,
    );

    expect(code, equals(ExitCode.success.code));
    final out = outBuffer.toString();
    expect(out, contains('SuiMEV LIQUIDATION MONITOR'));
    expect(out, contains('10.0000 SUI'));
    expect(out, contains(r'+$100.00 USD'));
    expect(out, contains('500 Total Monitored'));
    expect(errBuffer.toString(), isEmpty);
  });

  test('--once flag with missing state file displays friendly loading message and exits cleanly', () async {
    final nonExistentFile = '${tempDir.path}/does_not_exist.json';

    final outBuffer = StringBuffer();
    final code = await runCli(
      ['--state-file', nonExistentFile, '--once', '--no-color'],
      outSink: outBuffer,
    );

    expect(code, equals(ExitCode.success.code));
    final out = outBuffer.toString();
    expect(out, contains('Connecting to SuiMEV liquidator engine...'));
    expect(out, contains('does_not_exist.json'));
  });

  test('--compact flag in --once mode excludes activity feed', () async {
    await sampleStateFile.writeAsString(jsonEncode(samplePayload()));

    final outBuffer = StringBuffer();
    final code = await runCli(
      ['--state-file', sampleStateFile.path, '--once', '--compact', '--no-color'],
      outSink: outBuffer,
    );

    expect(code, equals(ExitCode.success.code));
    final out = outBuffer.toString();
    expect(out, contains('HOT ACCOUNTS WATCHLIST'));
    expect(out, isNot(contains('LIVE STRIKE ACTIVITY TICKER')));
  });
}
