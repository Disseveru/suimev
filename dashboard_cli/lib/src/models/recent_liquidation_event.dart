/// Model representing an individual liquidation strike event.
class RecentLiquidationEvent {
  final DateTime timestamp;
  final String protocol;
  final String borrower;
  final String debtRepaid;
  final String collateralSeized;
  final double netProfitUsd;
  final double? gasCostSui;
  final String txDigest;
  final String txDigestLink;

  const RecentLiquidationEvent({
    required this.timestamp,
    required this.protocol,
    required this.borrower,
    required this.debtRepaid,
    required this.collateralSeized,
    required this.netProfitUsd,
    this.gasCostSui,
    required this.txDigest,
    required this.txDigestLink,
  });

  factory RecentLiquidationEvent.fromJson(Map<String, dynamic> json) {
    DateTime parsedTime;
    final rawTs = json['timestamp'];
    if (rawTs is int) {
      parsedTime = DateTime.fromMillisecondsSinceEpoch(rawTs);
    } else if (rawTs is String) {
      parsedTime = DateTime.tryParse(rawTs) ?? DateTime.now();
    } else {
      parsedTime = DateTime.now();
    }

    String repaid = json['debtRepaid']?.toString() ?? '';
    if (repaid.isEmpty && json['debtRepaidAmount'] != null) {
      final sym = json['debtRepaidSymbol']?.toString() ?? '';
      repaid = '${json['debtRepaidAmount']} $sym'.trim();
    }

    String seized = json['collateralSeized']?.toString() ?? '';
    if (seized.isEmpty && json['collateralSeizedAmount'] != null) {
      final sym = json['collateralSeizedSymbol']?.toString() ?? '';
      seized = '${json['collateralSeizedAmount']} $sym'.trim();
    }

    final profit = (json['netProfitUsd'] ?? 0.0) as num;
    final gas = json['gasCostSui'] != null ? (json['gasCostSui'] as num).toDouble() : null;

    final digest = json['txDigest']?.toString() ?? '';
    final link = json['txDigestLink']?.toString() ??
        json['txDigestUrl']?.toString() ??
        (digest.isNotEmpty ? 'https://suiscan.xyz/mainnet/tx/$digest' : '');

    return RecentLiquidationEvent(
      timestamp: parsedTime,
      protocol: json['protocol']?.toString() ?? 'unknown',
      borrower: json['borrower']?.toString() ?? '',
      debtRepaid: repaid,
      collateralSeized: seized,
      netProfitUsd: profit.toDouble(),
      gasCostSui: gas,
      txDigest: digest,
      txDigestLink: link,
    );
  }

  String get shortBorrower {
    if (borrower.length <= 12) return borrower;
    return '${borrower.substring(0, 6)}...${borrower.substring(borrower.length - 4)}';
  }

  String get shortDigest {
    if (txDigest.length <= 12) return txDigest;
    return '${txDigest.substring(0, 6)}...${txDigest.substring(txDigest.length - 4)}';
  }

  String get formattedTime {
    final local = timestamp.toLocal();
    final h = local.hour.toString().padLeft(2, '0');
    final m = local.minute.toString().padLeft(2, '0');
    final s = local.second.toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  String get formattedProfit {
    final sign = netProfitUsd >= 0 ? '+' : '-';
    return '$sign\$${netProfitUsd.abs().toStringAsFixed(2)} USD';
  }

  Map<String, dynamic> toJson() => {
        'timestamp': timestamp.toIso8601String(),
        'protocol': protocol,
        'borrower': borrower,
        'debtRepaid': debtRepaid,
        'collateralSeized': collateralSeized,
        'netProfitUsd': netProfitUsd,
        if (gasCostSui != null) 'gasCostSui': gasCostSui,
        'txDigest': txDigest,
        'txDigestLink': txDigestLink,
      };
}
