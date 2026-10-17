import 'dart:convert';
import 'dart:io';

import 'package:dashboard_cli/src/poller/telemetry_reader.dart';
import 'package:test/test.dart';

void main() {
  late Directory tempDir;
  late File testFile;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('telemetry_reader_test_');
    testFile = File('${tempDir.path}/telemetry.json');
  });

  tearDown(() async {
    if (await tempDir.exists()) {
      await tempDir.delete(recursive: true);
    }
  });

  Map<String, dynamic> createSamplePayload({String status = 'ONLINE', double gas = 10.0}) {
    return {
      'timestamp': DateTime.now().toIso8601String(),
      'botStatus': status,
      'operator': {
        'address': '0x1234567890abcdef',
        'gasTankBalanceSui': gas,
        'gasTankBalanceMist': (gas * 1e9).toInt().toString(),
      },
      'financials': {
        'netRealizedPnlUsd': 50.0,
        'cumulativeGasSpentSui': 0.05,
        'successfulLiquidations': 1,
        'failedLiquidations': 0,
        'totalSimulations': 10,
      },
      'obligations': {
        'totalMonitored': 100,
        'naviCount': 60,
        'scallopCount': 40,
        'immediateTargetsCount': 0,
        'hotWatchlistCount': 2,
        'safeCount': 98,
      },
      'hotWatchlist': <Map<String, dynamic>>[],
      'recentLiquidations': <Map<String, dynamic>>[],
    };
  }

  test('returns loading state when telemetry file does not exist', () async {
    final reader = TelemetryReader(file: testFile);
    final result = await reader.readLatest();

    expect(result.isLoading, isTrue);
    expect(result.payload, isNull);
    expect(result.statusMessage, contains('Telemetry file not found'));
  });

  test('reads and parses valid telemetry file successfully', () async {
    final sampleData = createSamplePayload();
    await testFile.writeAsString(jsonEncode(sampleData));

    final reader = TelemetryReader(file: testFile);
    final result = await reader.readLatest();

    expect(result.isLoading, isFalse);
    expect(result.payload, isNotNull);
    expect(result.payload!.botStatus, equals('ONLINE'));
    expect(result.payload!.operator.gasBalanceSui, equals(10.0));
    expect(result.fromCache, isFalse);
  });

  test('optimizes disk reads via timestamp cache when file is unchanged', () async {
    final sampleData = createSamplePayload();
    await testFile.writeAsString(jsonEncode(sampleData));

    final reader = TelemetryReader(file: testFile);

    final firstResult = await reader.readLatest();
    expect(firstResult.isLoading, isFalse);
    expect(firstResult.fromCache, isFalse);

    // Second read without modification should return cached result
    final secondResult = await reader.readLatest();
    expect(secondResult.isLoading, isFalse);
    expect(secondResult.fromCache, isTrue);
    expect(secondResult.payload!.botStatus, equals('ONLINE'));

    // Forced read bypasses cache
    final forcedResult = await reader.readLatest(force: true);
    expect(forcedResult.fromCache, isFalse);
  });

  test('reads updated content when file modification timestamp changes', () async {
    final sample1 = createSamplePayload(status: 'ONLINE', gas: 10.0);
    await testFile.writeAsString(jsonEncode(sample1));

    final reader = TelemetryReader(file: testFile);
    final res1 = await reader.readLatest();
    expect(res1.payload!.operator.gasBalanceSui, equals(10.0));

    // Wait slightly so filesystem timestamp ticks forward
    await Future<void>.delayed(const Duration(milliseconds: 20));

    final sample2 = createSamplePayload(status: 'PAUSED', gas: 15.5);
    await testFile.writeAsString(jsonEncode(sample2));

    final res2 = await reader.readLatest();
    expect(res2.payload!.botStatus, equals('PAUSED'));
    expect(res2.payload!.operator.gasBalanceSui, equals(15.5));
    expect(res2.fromCache, isFalse);
  });

  test('handles corrupted / empty JSON payload gracefully with retries and fallback', () async {
    final sample = createSamplePayload(status: 'ONLINE');
    await testFile.writeAsString(jsonEncode(sample));

    final reader = TelemetryReader(
      file: testFile,
      maxRetries: 2,
      retryDelay: const Duration(milliseconds: 5),
    );

    // Initial valid read
    final initial = await reader.readLatest();
    expect(initial.isLoading, isFalse);

    await Future<void>.delayed(const Duration(milliseconds: 20));

    // Corrupt the file
    await testFile.writeAsString('{"timestamp": "corrupted json...');

    final corruptedResult = await reader.readLatest(force: true);
    // Should retain previous cached payload with a warning status
    expect(corruptedResult.payload, isNotNull);
    expect(corruptedResult.fromCache, isTrue);
    expect(corruptedResult.statusMessage, contains('Partial snapshot write detected'));
  });

  test('clearCache resets internal cached timestamp and payload', () async {
    final sample = createSamplePayload();
    await testFile.writeAsString(jsonEncode(sample));

    final reader = TelemetryReader(file: testFile);
    await reader.readLatest();

    reader.clearCache();
    // After clearCache, next read should read from disk
    final result = await reader.readLatest();
    expect(result.fromCache, isFalse);
  });
}
