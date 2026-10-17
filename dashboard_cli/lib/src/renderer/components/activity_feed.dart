import 'package:dashboard_cli/src/models/recent_liquidation_event.dart';
import 'package:dashboard_cli/src/terminal/ansi.dart';

/// Live activity ticker displaying recent liquidation strikes executed by the bot.
class ActivityFeed {
  static String render(
    List<RecentLiquidationEvent> events, {
    int maxEvents = 4,
    int width = 80,
  }) {
    final buffer = StringBuffer();
    final divider = '─' * (width - 4);

    buffer.writeln('  ${Ansi.boldWhite('LIVE STRIKE ACTIVITY TICKER (RECENT EXECUTIONS)')}');
    buffer.writeln('  $divider');

    if (events.isEmpty) {
      buffer.writeln('  ${Ansi.dimGray('Engine actively monitoring; no liquidations triggered yet.')}');
      return buffer.toString();
    }

    // Display in reverse chronological order (newest first)
    final sorted = List<RecentLiquidationEvent>.from(events)
      ..sort((a, b) => b.timestamp.compareTo(a.timestamp));

    final displayEvents = sorted.take(maxEvents).toList();
    for (final event in displayEvents) {
      final timeStr = Ansi.dimGray('[${event.formattedTime}]');
      final proto = Ansi.boldCyan(event.protocol.toUpperCase());
      final profitStr = event.netProfitUsd >= 0
          ? Ansi.boldGreen(event.formattedProfit)
          : Ansi.boldRed(event.formattedProfit);

      final digestStr = event.shortDigest.isNotEmpty
          ? Ansi.dimGray('(${event.shortDigest})')
          : '';

      final detail = 'Seized ${event.collateralSeized} for ${event.debtRepaid}';
      buffer.writeln('  $timeStr $proto: $detail | $profitStr $digestStr');
    }

    return buffer.toString();
  }
}
