import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../models/telemetry_payload.dart';

/// State wrapper indicating whether telemetry is ready, loading, or retaining cached data.
class TelemetryReadResult {
  final TelemetryPayload? payload;
  final bool isLoading;
  final String? statusMessage;
  final DateTime lastReadTime;
  final bool fromCache;

  const TelemetryReadResult({
    this.payload,
    required this.isLoading,
    this.statusMessage,
    required this.lastReadTime,
    this.fromCache = false,
  });

  factory TelemetryReadResult.loading([String message = 'Waiting for engine state snapshot...']) =>
      TelemetryReadResult(
        payload: null,
        isLoading: true,
        statusMessage: message,
        lastReadTime: DateTime.now(),
      );

  factory TelemetryReadResult.success(TelemetryPayload payload, {bool fromCache = false}) =>
      TelemetryReadResult(
        payload: payload,
        isLoading: false,
        statusMessage: null,
        lastReadTime: DateTime.now(),
        fromCache: fromCache,
      );

  factory TelemetryReadResult.retained(
    TelemetryPayload cachedPayload,
    String warningMessage,
  ) =>
      TelemetryReadResult(
        payload: cachedPayload,
        isLoading: false,
        statusMessage: warningMessage,
        lastReadTime: DateTime.now(),
        fromCache: true,
      );
}

/// Resilient poller for `.state/telemetry.json` with retry backoff and collision recovery.
class TelemetryReader {
  final File file;
  final int maxRetries;
  final Duration retryDelay;

  DateTime? _lastModified;
  TelemetryPayload? _cachedPayload;

  TelemetryReader({
    required this.file,
    this.maxRetries = 3,
    this.retryDelay = const Duration(milliseconds: 50),
  });

  /// Reads and parses the telemetry file with collision guards and fallback caching.
  Future<TelemetryReadResult> readLatest({bool force = false}) async {
    if (!await file.exists()) {
      return TelemetryReadResult.loading('Telemetry file not found: ${file.path}');
    }

    try {
      final stat = await file.stat();

      // Timestamp caching optimization: bypass read if file unchanged
      if (!force &&
          _lastModified != null &&
          stat.modified.isAtSameMomentAs(_lastModified!) &&
          _cachedPayload != null) {
        return TelemetryReadResult.success(_cachedPayload!, fromCache: true);
      }

      int attempt = 0;
      while (attempt <= maxRetries) {
        try {
          final content = await file.readAsString();
          if (content.trim().isEmpty) {
            throw const FormatException('Empty telemetry snapshot payload');
          }

          final dynamic parsed = jsonDecode(content);
          if (parsed is! Map<String, dynamic>) {
            throw const FormatException('Expected top-level JSON object in telemetry snapshot');
          }

          final payload = TelemetryPayload.fromJson(parsed);
          _cachedPayload = payload;
          _lastModified = stat.modified;
          return TelemetryReadResult.success(payload);
        } on FileSystemException {
          // File locked during atomic replacement on Windows (EBUSY / EPERM)
          attempt++;
          if (attempt > maxRetries) {
            if (_cachedPayload != null) {
              return TelemetryReadResult.retained(
                _cachedPayload!,
                'File temporarily locked by engine; showing cached metrics',
              );
            }
            return TelemetryReadResult.loading('Waiting for engine to release state file lock...');
          }
          await Future<void>.delayed(retryDelay);
        } on FormatException {
          // Incomplete write buffer in flight
          attempt++;
          if (attempt > maxRetries) {
            if (_cachedPayload != null) {
              return TelemetryReadResult.retained(
                _cachedPayload!,
                'Partial snapshot write detected; showing cached metrics',
              );
            }
            return TelemetryReadResult.loading('Waiting for atomic snapshot flush...');
          }
          await Future<void>.delayed(retryDelay);
        }
      }
    } catch (e) {
      if (_cachedPayload != null) {
        return TelemetryReadResult.retained(
          _cachedPayload!,
          'Read error ($e); retaining previous metrics',
        );
      }
      return TelemetryReadResult.loading('Error reading telemetry: $e');
    }

    return TelemetryReadResult.loading();
  }

  /// Clears the cached modification timestamp and payload.
  void clearCache() {
    _lastModified = null;
    _cachedPayload = null;
  }
}
