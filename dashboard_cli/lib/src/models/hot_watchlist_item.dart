/// Model representing an obligation on the liquidation watchlist.
class HotWatchlistItem {
  final String obligationId;
  final String protocol;
  final String borrower;
  final double healthFactor;
  final double totalDebtUsd;
  final double totalCollateralUsd;
  final String urgency;

  const HotWatchlistItem({
    required this.obligationId,
    required this.protocol,
    required this.borrower,
    required this.healthFactor,
    required this.totalDebtUsd,
    required this.totalCollateralUsd,
    required this.urgency,
  });

  factory HotWatchlistItem.fromJson(Map<String, dynamic> json) {
    final hf = (json['healthFactor'] ?? 1.0) as num;
    final debt = (json['totalDebtUsd'] ?? 0.0) as num;
    final collateral = (json['totalCollateralUsd'] ?? 0.0) as num;
    final urg = json['urgency']?.toString().toUpperCase() ??
        (hf < 1.0 ? 'STRIKE' : (hf < 1.02 ? 'CRITICAL' : 'HOT'));

    return HotWatchlistItem(
      obligationId: json['obligationId']?.toString() ?? '',
      protocol: json['protocol']?.toString() ?? 'unknown',
      borrower: json['borrower']?.toString() ?? json['ownerAddress']?.toString() ?? '',
      healthFactor: hf.toDouble(),
      totalDebtUsd: debt.toDouble(),
      totalCollateralUsd: collateral.toDouble(),
      urgency: urg,
    );
  }

  bool get isStrikeZone => healthFactor < 1.00;
  bool get isCaution => healthFactor >= 1.00 && healthFactor < 1.05;
  bool get isSafe => healthFactor >= 1.05;

  String get shortObligationId {
    if (obligationId.length <= 12) return obligationId;
    return '${obligationId.substring(0, 6)}...${obligationId.substring(obligationId.length - 4)}';
  }

  String get shortBorrower {
    if (borrower.length <= 12) return borrower;
    return '${borrower.substring(0, 6)}...${borrower.substring(borrower.length - 4)}';
  }

  String get formattedHealthFactor => healthFactor.toStringAsFixed(4);

  String get formattedDebt => '\$${totalDebtUsd.toStringAsFixed(2)}';

  String get formattedCollateral => '\$${totalCollateralUsd.toStringAsFixed(2)}';

  Map<String, dynamic> toJson() => {
        'obligationId': obligationId,
        'protocol': protocol,
        'borrower': borrower,
        'healthFactor': healthFactor,
        'totalDebtUsd': totalDebtUsd,
        'totalCollateralUsd': totalCollateralUsd,
        'urgency': urgency,
      };
}
