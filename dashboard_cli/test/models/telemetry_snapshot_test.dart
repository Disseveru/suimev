import 'package:dashboard_cli/src/models/models.dart';
import 'package:test/test.dart';

void main() {
  group('OperatorState Model Tests', () {
    test('deserializes complete operator payload correctly', () {
      final json = <String, dynamic>{
        'address': '0x58c679e9596395dc553cb7b22a012a67e8876c12c759ae1b6d0d21650b299e58',
        'gasTankBalanceSui': 14.8210,
        'gasTankBalanceMist': '14821000000',
        'gasBalanceUsd': 48.25,
        'cachedGasCoinId': '0x4f1234567890abcdef',
        'isSufficient': true,
      };

      final op = OperatorState.fromJson(json);
      expect(op.address, equals('0x58c679e9596395dc553cb7b22a012a67e8876c12c759ae1b6d0d21650b299e58'));
      expect(op.gasBalanceSui, equals(14.8210));
      expect(op.gasBalanceMist, equals('14821000000'));
      expect(op.gasBalanceUsd, equals(48.25));
      expect(op.cachedGasCoinId, equals('0x4f1234567890abcdef'));
      expect(op.isSufficient, isTrue);

      expect(op.shortAddress, equals('0x58c6...9e58'));
      expect(op.formattedSui, equals('14.8210 SUI'));
      expect(op.formattedUsd, equals('\$48.25 USD'));
    });

    test('supports alternative property names (gasBalanceSui / gasBalanceMist)', () {
      final json = <String, dynamic>{
        'address': '0x1234567890abcdef1234',
        'gasBalanceSui': 2.5,
        'gasBalanceMist': '2500000000',
      };

      final op = OperatorState.fromJson(json);
      expect(op.gasBalanceSui, equals(2.5));
      expect(op.gasBalanceMist, equals('2500000000'));
      expect(op.isSufficient, isTrue);
    });

    test('handles empty / fallback operator state', () {
      final op = OperatorState.empty();
      expect(op.gasBalanceSui, equals(0.0));
      expect(op.gasBalanceMist, equals('0'));
      expect(op.isSufficient, isFalse);
    });
  });

  group('FinancialState Model Tests', () {
    test('deserializes full financials data correctly', () {
      final json = <String, dynamic>{
        'netRealizedPnlUsd': 1245.50,
        'cumulativeGasSpentSui': 0.1842,
        'cumulativeGasCostUsd': 0.60,
        'successfulLiquidations': 14,
        'failedLiquidations': 0,
        'totalSimulations': 86,
        'successfulSimulations': 32,
        'totalLiquidationsAttempted': 14,
      };

      final fin = FinancialState.fromJson(json);
      expect(fin.netRealizedPnlUsd, equals(1245.50));
      expect(fin.cumulativeGasSpentSui, equals(0.1842));
      expect(fin.cumulativeGasCostUsd, equals(0.60));
      expect(fin.successfulLiquidations, equals(14));
      expect(fin.failedLiquidations, equals(0));
      expect(fin.totalSimulations, equals(86));
      expect(fin.successfulSimulations, equals(32));
      expect(fin.totalLiquidationsAttempted, equals(14));

      expect(fin.formattedPnl, equals('+\$1245.50 USD'));
      expect(fin.formattedGasSpent, equals('0.1842 SUI'));
      expect(fin.winRate, equals(100.0));
      expect(fin.winRateFormatted, equals('100.0%'));
    });

    test('handles negative net profit correctly', () {
      final json = <String, dynamic>{
        'netRealizedPnlUsd': -45.20,
        'cumulativeGasSpentSui': 0.5,
        'successfulLiquidations': 1,
        'failedLiquidations': 3,
        'totalSimulations': 10,
      };

      final fin = FinancialState.fromJson(json);
      expect(fin.netRealizedPnlUsd, equals(-45.20));
      expect(fin.formattedPnl, equals('-\$45.20 USD'));
      expect(fin.winRate, equals(25.0));
    });

    test('supports alternative property name cumulativeNetProfitUsd', () {
      final json = <String, dynamic>{
        'cumulativeNetProfitUsd': 320.00,
        'cumulativeGasSpentSui': 0.1,
        'successfulLiquidations': 2,
        'failedLiquidations': 0,
        'totalSimulations': 5,
      };

      final fin = FinancialState.fromJson(json);
      expect(fin.netRealizedPnlUsd, equals(320.00));
    });
  });

  group('ObligationSummary Model Tests', () {
    test('deserializes flat obligation summary correctly', () {
      final json = <String, dynamic>{
        'totalMonitored': 1240,
        'naviCount': 780,
        'scallopCount': 460,
        'immediateTargetsCount': 0,
        'hotWatchlistCount': 8,
        'safeCount': 1232,
      };

      final summary = ObligationSummary.fromJson(json);
      expect(summary.totalMonitored, equals(1240));
      expect(summary.naviCount, equals(780));
      expect(summary.scallopCount, equals(460));
      expect(summary.immediateTargetsCount, equals(0));
      expect(summary.hotWatchlistCount, equals(8));
      expect(summary.safeCount, equals(1232));
    });

    test('supports nested byProtocol format and computes safe count', () {
      final json = <String, dynamic>{
        'total': 1000,
        'immediateTargets': 2,
        'hotWatchlist': 10,
        'byProtocol': {
          'navi': {'total': 600},
          'scallop': {'total': 400},
        },
      };

      final summary = ObligationSummary.fromJson(json);
      expect(summary.totalMonitored, equals(1000));
      expect(summary.naviCount, equals(600));
      expect(summary.scallopCount, equals(400));
      expect(summary.immediateTargetsCount, equals(2));
      expect(summary.hotWatchlistCount, equals(10));
      expect(summary.safeCount, equals(988));
    });
  });

  group('HotWatchlistItem Model Tests', () {
    test('correctly evaluates risk tier categories', () {
      final strikeItem = HotWatchlistItem.fromJson(<String, dynamic>{
        'obligationId': '0x3b890123cdef456789abcdef0123456789abcdef',
        'protocol': 'scallop',
        'borrower': '0x9876543210fedcba9876543210fedcba98765432',
        'healthFactor': 0.9842,
        'totalDebtUsd': 5420.00,
        'totalCollateralUsd': 5890.00,
      });

      expect(strikeItem.isStrikeZone, isTrue);
      expect(strikeItem.isCaution, isFalse);
      expect(strikeItem.isSafe, isFalse);
      expect(strikeItem.urgency, equals('STRIKE'));
      expect(strikeItem.shortObligationId, equals('0x3b89...cdef'));
      expect(strikeItem.shortBorrower, equals('0x9876...5432'));
      expect(strikeItem.formattedHealthFactor, equals('0.9842'));
      expect(strikeItem.formattedDebt, equals('\$5420.00'));
      expect(strikeItem.formattedCollateral, equals('\$5890.00'));

      final cautionItem = HotWatchlistItem.fromJson(<String, dynamic>{
        'obligationId': '0x8a3f8102a9b23c4d5e6f7a8b9c0d1e2f3a4b5c6d',
        'protocol': 'navi',
        'borrower': '0x1234567890abcdef1234567890abcdef12345678',
        'healthFactor': 1.0145,
        'totalDebtUsd': 12450.00,
        'totalCollateralUsd': 13900.50,
      });

      expect(cautionItem.isStrikeZone, isFalse);
      expect(cautionItem.isCaution, isTrue);
      expect(cautionItem.isSafe, isFalse);

      final safeItem = HotWatchlistItem.fromJson(<String, dynamic>{
        'obligationId': '0x1111222233334444555566667777888899990000',
        'protocol': 'navi',
        'borrower': '0xaaaa',
        'healthFactor': 1.1500,
        'totalDebtUsd': 1000.00,
        'totalCollateralUsd': 2000.00,
      });

      expect(safeItem.isStrikeZone, isFalse);
      expect(safeItem.isCaution, isFalse);
      expect(safeItem.isSafe, isTrue);
    });
  });

  group('RecentLiquidationEvent Model Tests', () {
    test('deserializes ISO timestamp and formats strike event', () {
      final json = <String, dynamic>{
        'timestamp': '2026-10-16T10:14:02.000Z',
        'protocol': 'navi',
        'borrower': '0x3b890123456789abcdef',
        'debtRepaid': '2,500.00 USDC',
        'collateralSeized': '812.50 SUI',
        'netProfitUsd': 135.20,
        'gasCostSui': 0.045,
        'txDigest': 'Gz3t8qK7L9vN2mP5wR8sT1uX4yZ6aB9cD2eF5gH8jK1',
        'txDigestLink': 'https://suiscan.xyz/mainnet/tx/Gz3t8qK7L9vN2mP5wR8sT1uX4yZ6aB9cD2eF5gH8jK1',
      };

      final event = RecentLiquidationEvent.fromJson(json);
      expect(event.protocol, equals('navi'));
      expect(event.borrower, equals('0x3b890123456789abcdef'));
      expect(event.debtRepaid, equals('2,500.00 USDC'));
      expect(event.collateralSeized, equals('812.50 SUI'));
      expect(event.netProfitUsd, equals(135.20));
      expect(event.gasCostSui, equals(0.045));
      expect(event.txDigest, equals('Gz3t8qK7L9vN2mP5wR8sT1uX4yZ6aB9cD2eF5gH8jK1'));

      expect(event.shortBorrower, equals('0x3b89...cdef'));
      expect(event.shortDigest, equals('Gz3t8q...8jK1'));
      expect(event.formattedProfit, equals('+\$135.20 USD'));
    });

    test('supports epoch milliseconds and decomposed symbol/amount fields', () {
      final json = <String, dynamic>{
        'timestamp': 1729073610000,
        'protocol': 'scallop',
        'borrower': '0xbeef',
        'debtRepaidSymbol': 'USDT',
        'debtRepaidAmount': '1000.00',
        'collateralSeizedSymbol': 'SUI',
        'collateralSeizedAmount': '350.00',
        'netProfitUsd': 45.00,
        'txDigest': '0xabc123',
      };

      final event = RecentLiquidationEvent.fromJson(json);
      expect(event.debtRepaid, equals('1000.00 USDT'));
      expect(event.collateralSeized, equals('350.00 SUI'));
      expect(event.txDigestLink, equals('https://suiscan.xyz/mainnet/tx/0xabc123'));
    });
  });

  group('TelemetryPayload Root Model Tests', () {
    test('deserializes complete engine payload with all sub-models', () {
      final json = <String, dynamic>{
        'timestamp': '2026-10-16T10:45:00.000Z',
        'botStatus': 'ONLINE',
        'operator': {
          'address': '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          'gasTankBalanceSui': 14.8523,
          'gasTankBalanceMist': '14852300000',
        },
        'financials': {
          'netRealizedPnlUsd': 124.50,
          'cumulativeGasSpentSui': 1.254,
          'successfulLiquidations': 3,
          'failedLiquidations': 0,
          'totalSimulations': 842,
        },
        'obligations': {
          'totalMonitored': 1420,
          'naviCount': 850,
          'scallopCount': 570,
          'immediateTargetsCount': 0,
          'hotWatchlistCount': 4,
          'safeCount': 1416,
        },
        'hotWatchlist': [
          {
            'obligationId': '0xabc123456789',
            'protocol': 'navi',
            'borrower': '0xdef123456789',
            'healthFactor': 1.0234,
            'totalDebtUsd': 15420.50,
            'totalCollateralUsd': 15780.00,
            'urgency': 'HOT',
          }
        ],
        'recentLiquidations': [
          {
            'timestamp': '2026-10-16T10:42:15.000Z',
            'protocol': 'scallop',
            'borrower': '0x789012345678',
            'debtRepaid': '5,000.00 USDC',
            'collateralSeized': '2,450.12 SUI',
            'netProfitUsd': 42.15,
            'gasCostSui': 0.045,
            'txDigest': '5cZ8X1234567890',
            'txDigestLink': 'https://suiscan.xyz/mainnet/tx/5cZ8X1234567890',
          }
        ],
        'engine': {
          'network': 'mainnet',
          'mode': 'live',
          'uptimeSeconds': 3600,
          'rpcEndpoint': 'Alchemy Dedicated Node',
        },
      };

      final payload = TelemetryPayload.fromJson(json);
      expect(payload.botStatus, equals('ONLINE'));
      expect(payload.isOnline, isTrue);
      expect(payload.isPaused, isFalse);
      expect(payload.isError, isFalse);
      expect(payload.network, equals('mainnet'));
      expect(payload.mode, equals('live'));
      expect(payload.uptimeSeconds, equals(3600));
      expect(payload.formattedUptime, equals('1h 0m 0s'));
      expect(payload.rpcEndpoint, equals('Alchemy Dedicated Node'));

      expect(payload.operator.gasBalanceSui, equals(14.8523));
      expect(payload.financials.netRealizedPnlUsd, equals(124.50));
      expect(payload.obligations.totalMonitored, equals(1420));
      expect(payload.hotWatchlist.length, equals(1));
      expect(payload.recentLiquidations.length, equals(1));
    });

    test('serializes back to JSON matching expected structure', () {
      final original = TelemetryPayload.empty();
      final map = original.toJson();

      expect(map['botStatus'], equals('OFFLINE'));
      expect(map['operator'], isA<Map<String, dynamic>>());
      expect(map['financials'], isA<Map<String, dynamic>>());
      expect(map['obligations'], isA<Map<String, dynamic>>());
      expect(map['hotWatchlist'], isA<List<dynamic>>());
      expect(map['recentLiquidations'], isA<List<dynamic>>());
    });
  });
}
