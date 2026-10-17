/// Operator wallet and gas tank telemetry model.
class OperatorState {
  final String address;
  final double gasBalanceSui;
  final String gasBalanceMist;
  final double? gasBalanceUsd;
  final String? cachedGasCoinId;
  final bool isSufficient;

  const OperatorState({
    required this.address,
    required this.gasBalanceSui,
    required this.gasBalanceMist,
    this.gasBalanceUsd,
    this.cachedGasCoinId,
    this.isSufficient = true,
  });

  factory OperatorState.fromJson(Map<String, dynamic> json) {
    final suiBalance = (json['gasTankBalanceSui'] ?? json['gasBalanceSui'] ?? 0.0) as num;
    final mistBalance = json['gasTankBalanceMist']?.toString() ??
        json['gasBalanceMist']?.toString() ??
        (suiBalance * 1e9).toInt().toString();

    final usdBalance = json['gasBalanceUsd'] != null
        ? (json['gasBalanceUsd'] as num).toDouble()
        : null;

    final coinId = json['cachedGasCoinId']?.toString();
    final sufficient = json['isSufficient'] != null
        ? json['isSufficient'] == true
        : suiBalance >= 0.1;

    return OperatorState(
      address: json['address']?.toString() ?? '0x0000...0000',
      gasBalanceSui: suiBalance.toDouble(),
      gasBalanceMist: mistBalance,
      gasBalanceUsd: usdBalance,
      cachedGasCoinId: coinId,
      isSufficient: sufficient,
    );
  }

  factory OperatorState.empty() => const OperatorState(
        address: '0x0000000000000000000000000000000000000000000000000000000000000000',
        gasBalanceSui: 0.0,
        gasBalanceMist: '0',
        gasBalanceUsd: 0.0,
        isSufficient: false,
      );

  String get shortAddress {
    if (address.length <= 12) return address;
    return '${address.substring(0, 6)}...${address.substring(address.length - 4)}';
  }

  String get formattedSui => '${gasBalanceSui.toStringAsFixed(4)} SUI';

  String get formattedUsd {
    if (gasBalanceUsd != null) {
      return '\$${gasBalanceUsd!.toStringAsFixed(2)} USD';
    }
    return '';
  }

  Map<String, dynamic> toJson() => {
        'address': address,
        'gasTankBalanceSui': gasBalanceSui,
        'gasTankBalanceMist': gasBalanceMist,
        if (gasBalanceUsd != null) 'gasBalanceUsd': gasBalanceUsd,
        if (cachedGasCoinId != null) 'cachedGasCoinId': cachedGasCoinId,
        'isSufficient': isSufficient,
      };
}
