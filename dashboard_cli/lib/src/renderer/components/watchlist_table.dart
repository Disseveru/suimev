import 'package:dashboard_cli/src/models/hot_watchlist_item.dart';
import 'package:dashboard_cli/src/renderer/formatters.dart';
import 'package:dashboard_cli/src/terminal/ansi.dart';

/// Tabular display of high-priority obligations near or below the liquidation threshold.
class WatchlistTable {
  static String render(
    List<HotWatchlistItem> items, {
    int maxItems = 6,
    int width = 80,
  }) {
    final buffer = StringBuffer();
    final divider = '─' * (width - 4);

    buffer.writeln('  ${Ansi.boldWhite('HOT ACCOUNTS WATCHLIST (TOP NEAR-STRIKE TARGETS)')}');
    buffer.writeln('  $divider');

    if (items.isEmpty) {
      buffer.writeln('  ${Ansi.boldGreen('✓ No obligations in strike zone (All accounts healthy HF >= 1.05)')}');
      return buffer.toString();
    }

    // Table header
    final headerProtocol = Ansi.padRight('PROTOCOL', 10);
    final headerBorrower = Ansi.padRight('BORROWER', 16);
    final headerHf = Ansi.padRight('HEALTH FACTOR', 18);
    final headerDebt = Ansi.padRight('DEBT (USD)', 15);
    final headerCollateral = Ansi.padRight('COLLATERAL (USD)', 16);

    final headerLine = '$headerProtocol$headerBorrower$headerHf$headerDebt$headerCollateral';
    buffer.writeln('  ${Ansi.dimGray(headerLine)}');

    final displayItems = items.take(maxItems).toList();
    for (final item in displayItems) {
      final protoStr = Ansi.padRight(item.protocol.toUpperCase(), 10);
      final borrowerStr = Ansi.padRight(item.shortBorrower, 16);

      // Health factor styling by risk tier
      String hfBadge;
      if (item.isStrikeZone) {
        hfBadge = Ansi.boldRed('${item.formattedHealthFactor} [STRIKE]');
      } else if (item.healthFactor < 1.02) {
        hfBadge = Ansi.boldYellow('${item.formattedHealthFactor} [CRITICAL]');
      } else if (item.isCaution) {
        hfBadge = Ansi.boldYellow('${item.formattedHealthFactor} [HOT]');
      } else {
        hfBadge = Ansi.boldGreen('${item.formattedHealthFactor} [SAFE]');
      }
      final hfStr = Ansi.padRight(hfBadge, 18);

      final debtStr = Ansi.padRight(Formatters.formatUsd(item.totalDebtUsd), 15);
      final collStr = Ansi.padRight(Formatters.formatUsd(item.totalCollateralUsd), 16);

      buffer.writeln('  $protoStr$borrowerStr$hfStr$debtStr$collStr');
    }

    if (items.length > maxItems) {
      buffer.writeln('  ${Ansi.dimGray('... and ${items.length - maxItems} more accounts under surveillance')}');
    }

    return buffer.toString();
  }
}
