/// Summary of obligation counts monitored across lending protocols.
class ObligationSummary {
  final int totalMonitored;
  final int naviCount;
  final int scallopCount;
  final int immediateTargetsCount;
  final int hotWatchlistCount;
  final int safeCount;

  const ObligationSummary({
    required this.totalMonitored,
    required this.naviCount,
    required this.scallopCount,
    required this.immediateTargetsCount,
    required this.hotWatchlistCount,
    required this.safeCount,
  });

  factory ObligationSummary.fromJson(Map<String, dynamic> json) {
    int total = (json['totalMonitored'] ?? json['total'] ?? 0) as int;
    int navi = (json['naviCount'] ?? 0) as int;
    int scallop = (json['scallopCount'] ?? 0) as int;
    int immediate = (json['immediateTargetsCount'] ?? json['immediateTargets'] ?? 0) as int;
    int hot = (json['hotWatchlistCount'] ?? json['hotWatchlist'] ?? 0) as int;
    int safe = (json['safeCount'] ?? json['safe'] ?? 0) as int;

    // Support nested byProtocol format if present
    if (json['byProtocol'] is Map<String, dynamic>) {
      final byProto = json['byProtocol'] as Map<String, dynamic>;
      if (byProto['navi'] is Map<String, dynamic>) {
        navi = (byProto['navi']['total'] ?? navi) as int;
      }
      if (byProto['scallop'] is Map<String, dynamic>) {
        scallop = (byProto['scallop']['total'] ?? scallop) as int;
      }
    }

    if (total == 0 && (navi > 0 || scallop > 0)) {
      total = navi + scallop;
    }

    if (safe == 0 && total > 0) {
      safe = total - (immediate + hot);
      if (safe < 0) safe = 0;
    }

    return ObligationSummary(
      totalMonitored: total,
      naviCount: navi,
      scallopCount: scallop,
      immediateTargetsCount: immediate,
      hotWatchlistCount: hot,
      safeCount: safe,
    );
  }

  factory ObligationSummary.empty() => const ObligationSummary(
        totalMonitored: 0,
        naviCount: 0,
        scallopCount: 0,
        immediateTargetsCount: 0,
        hotWatchlistCount: 0,
        safeCount: 0,
      );

  Map<String, dynamic> toJson() => {
        'totalMonitored': totalMonitored,
        'naviCount': naviCount,
        'scallopCount': scallopCount,
        'immediateTargetsCount': immediateTargetsCount,
        'hotWatchlistCount': hotWatchlistCount,
        'safeCount': safeCount,
      };
}
