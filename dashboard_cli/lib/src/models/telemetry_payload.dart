import 'financial_state.dart';
import 'hot_watchlist_item.dart';
import 'obligation_summary.dart';
import 'operator_state.dart';
import 'recent_liquidation_event.dart';

/// Top-level telemetry payload emitted by the liquidator engine.
class TelemetryPayload {
  final DateTime timestamp;
  final String botStatus;
  final OperatorState operator;
  final FinancialState financials;
  final ObligationSummary obligations;
  final List<HotWatchlistItem> hotWatchlist;
  final List<RecentLiquidationEvent> recentLiquidations;

  // Optional engine metadata
  final String? network;
  final String? mode;
  final int? uptimeSeconds;
  final String? rpcEndpoint;

  const TelemetryPayload({
    required this.timestamp,
    required this.botStatus,
    required this.operator,
    required this.financials,
    required this.obligations,
    required this.hotWatchlist,
    required this.recentLiquidations,
    this.network,
    this.mode,
    this.uptimeSeconds,
    this.rpcEndpoint,
  });

  factory TelemetryPayload.fromJson(Map<String, dynamic> json) {
    DateTime parsedTime;
    final rawTs = json['timestamp'];
    if (rawTs is int) {
      parsedTime = DateTime.fromMillisecondsSinceEpoch(rawTs);
    } else if (rawTs is String) {
      parsedTime = DateTime.tryParse(rawTs) ?? DateTime.now();
    } else {
      parsedTime = DateTime.now();
    }

    final status = json['botStatus']?.toString() ?? json['status']?.toString() ?? 'ONLINE';

    final operatorMap = json['operator'] is Map<String, dynamic>
        ? json['operator'] as Map<String, dynamic>
        : <String, dynamic>{};

    final financialsMap = json['financials'] is Map<String, dynamic>
        ? json['financials'] as Map<String, dynamic>
        : (json['pnl'] is Map<String, dynamic> ? json['pnl'] as Map<String, dynamic> : <String, dynamic>{});

    final obligationsMap = json['obligations'] is Map<String, dynamic>
        ? json['obligations'] as Map<String, dynamic>
        : <String, dynamic>{};

    final rawWatchlist = json['hotWatchlist'];
    final watchlist = <HotWatchlistItem>[];
    if (rawWatchlist is List) {
      for (final item in rawWatchlist) {
        if (item is Map<String, dynamic>) {
          watchlist.add(HotWatchlistItem.fromJson(item));
        }
      }
    }

    final rawEvents = json['recentLiquidations'] ?? json['recentEvents'];
    final events = <RecentLiquidationEvent>[];
    if (rawEvents is List) {
      for (final item in rawEvents) {
        if (item is Map<String, dynamic>) {
          events.add(RecentLiquidationEvent.fromJson(item));
        }
      }
    }

    String? net;
    String? m;
    int? uptime;
    String? rpc;
    if (json['engine'] is Map<String, dynamic>) {
      final eng = json['engine'] as Map<String, dynamic>;
      net = eng['network']?.toString();
      m = eng['mode']?.toString();
      uptime = eng['uptimeSeconds'] is int ? eng['uptimeSeconds'] as int : null;
      rpc = eng['rpcEndpoint']?.toString();
    }

    return TelemetryPayload(
      timestamp: parsedTime,
      botStatus: status.toUpperCase(),
      operator: OperatorState.fromJson(operatorMap),
      financials: FinancialState.fromJson(financialsMap),
      obligations: ObligationSummary.fromJson(obligationsMap),
      hotWatchlist: watchlist,
      recentLiquidations: events,
      network: net,
      mode: m,
      uptimeSeconds: uptime,
      rpcEndpoint: rpc,
    );
  }

  factory TelemetryPayload.empty() => TelemetryPayload(
        timestamp: DateTime.now(),
        botStatus: 'OFFLINE',
        operator: OperatorState.empty(),
        financials: FinancialState.empty(),
        obligations: ObligationSummary.empty(),
        hotWatchlist: const [],
        recentLiquidations: const [],
      );

  bool get isOnline => botStatus == 'ONLINE';
  bool get isPaused => botStatus == 'PAUSED';
  bool get isError => botStatus == 'ERROR';

  String get formattedUptime {
    if (uptimeSeconds == null) return '';
    final d = Duration(seconds: uptimeSeconds!);
    final h = d.inHours;
    final m = d.inMinutes.remainder(60);
    final s = d.inSeconds.remainder(60);
    return '${h}h ${m}m ${s}s';
  }

  Map<String, dynamic> toJson() => {
        'timestamp': timestamp.toIso8601String(),
        'botStatus': botStatus,
        'operator': operator.toJson(),
        'financials': financials.toJson(),
        'obligations': obligations.toJson(),
        'hotWatchlist': hotWatchlist.map((w) => w.toJson()).toList(),
        'recentLiquidations': recentLiquidations.map((e) => e.toJson()).toList(),
        if (network != null || mode != null || uptimeSeconds != null || rpcEndpoint != null)
          'engine': {
            if (network != null) 'network': network,
            if (mode != null) 'mode': mode,
            if (uptimeSeconds != null) 'uptimeSeconds': uptimeSeconds,
            if (rpcEndpoint != null) 'rpcEndpoint': rpcEndpoint,
          },
      };
}
