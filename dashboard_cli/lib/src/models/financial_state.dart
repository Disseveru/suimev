/// Financial performance metrics and liquidation statistics.
class FinancialState {
  final double netRealizedPnlUsd;
  final double cumulativeGasSpentSui;
  final double? cumulativeGasCostUsd;
  final int successfulLiquidations;
  final int failedLiquidations;
  final int totalSimulations;
  final int? successfulSimulations;
  final int? totalLiquidationsAttempted;

  const FinancialState({
    required this.netRealizedPnlUsd,
    required this.cumulativeGasSpentSui,
    this.cumulativeGasCostUsd,
    required this.successfulLiquidations,
    required this.failedLiquidations,
    required this.totalSimulations,
    this.successfulSimulations,
    this.totalLiquidationsAttempted,
  });

  factory FinancialState.fromJson(Map<String, dynamic> json) {
    final pnl = (json['netRealizedPnlUsd'] ?? json['cumulativeNetProfitUsd'] ?? 0.0) as num;
    final gasSui = (json['cumulativeGasSpentSui'] ?? 0.0) as num;
    final gasUsd = json['cumulativeGasCostUsd'] != null
        ? (json['cumulativeGasCostUsd'] as num).toDouble()
        : null;

    final successful = (json['successfulLiquidations'] ?? 0) as int;
    final failed = (json['failedLiquidations'] ?? 0) as int;
    final totalSims = (json['totalSimulations'] ?? 0) as int;
    final successSims = json['successfulSimulations'] != null
        ? (json['successfulSimulations'] as int)
        : null;
    final attempted = json['totalLiquidationsAttempted'] != null
        ? (json['totalLiquidationsAttempted'] as int)
        : (successful + failed);

    return FinancialState(
      netRealizedPnlUsd: pnl.toDouble(),
      cumulativeGasSpentSui: gasSui.toDouble(),
      cumulativeGasCostUsd: gasUsd,
      successfulLiquidations: successful,
      failedLiquidations: failed,
      totalSimulations: totalSims,
      successfulSimulations: successSims,
      totalLiquidationsAttempted: attempted,
    );
  }

  factory FinancialState.empty() => const FinancialState(
        netRealizedPnlUsd: 0.0,
        cumulativeGasSpentSui: 0.0,
        successfulLiquidations: 0,
        failedLiquidations: 0,
        totalSimulations: 0,
      );

  String get formattedPnl {
    final sign = netRealizedPnlUsd >= 0 ? '+' : '-';
    final absVal = netRealizedPnlUsd.abs().toStringAsFixed(2);
    return '$sign\$$absVal USD';
  }

  String get formattedGasSpent => '${cumulativeGasSpentSui.toStringAsFixed(4)} SUI';

  double get winRate {
    final total = (totalLiquidationsAttempted ?? (successfulLiquidations + failedLiquidations));
    if (total == 0) return 100.0;
    return (successfulLiquidations / total) * 100.0;
  }

  String get winRateFormatted => '${winRate.toStringAsFixed(1)}%';

  Map<String, dynamic> toJson() => {
        'netRealizedPnlUsd': netRealizedPnlUsd,
        'cumulativeGasSpentSui': cumulativeGasSpentSui,
        if (cumulativeGasCostUsd != null) 'cumulativeGasCostUsd': cumulativeGasCostUsd,
        'successfulLiquidations': successfulLiquidations,
        'failedLiquidations': failedLiquidations,
        'totalSimulations': totalSimulations,
        if (successfulSimulations != null) 'successfulSimulations': successfulSimulations,
        if (totalLiquidationsAttempted != null) 'totalLiquidationsAttempted': totalLiquidationsAttempted,
      };
}
