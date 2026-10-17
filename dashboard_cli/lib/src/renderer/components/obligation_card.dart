import 'package:dashboard_cli/src/models/obligation_summary.dart';
import 'package:dashboard_cli/src/renderer/formatters.dart';
import 'package:dashboard_cli/src/terminal/ansi.dart';

/// Obligation queue overview showing account counts across risk tiers and lending protocols.
class ObligationCard {
  static String render(ObligationSummary obligations, {int width = 80}) {
    final buffer = StringBuffer();
    final divider = '─' * (width - 4);

    final totalFormatted = Formatters.formatInteger(obligations.totalMonitored);
    buffer.writeln('  ${Ansi.boldWhite('OBLIGATION QUEUES ($totalFormatted Total Monitored)')}');
    buffer.writeln('  $divider');

    // Strike Zone
    final strikeCount = Formatters.formatInteger(obligations.immediateTargetsCount);
    final strikeText = obligations.immediateTargetsCount > 0
        ? Ansi.strikeBadge(' $strikeCount ACCOUNTS READY TO LIQUIDATE ')
        : Ansi.dimGray('$strikeCount accounts [None]');
    buffer.writeln('  🚨 Strike Zone (HF < 1.00):          $strikeText');

    // Hot Watchlist
    final hotCount = Formatters.formatInteger(obligations.hotWatchlistCount);
    final hotText = obligations.hotWatchlistCount > 0
        ? Ansi.boldYellow('$hotCount accounts [High-Frequency Surveillance]')
        : Ansi.dimGray('$hotCount accounts [None]');
    buffer.writeln('  🔥 Hot Watchlist (1.00 <= HF < 1.05): $hotText');

    // Safe Accounts
    final safeCount = Formatters.formatInteger(obligations.safeCount);
    final safeText = Ansi.boldGreen('$safeCount accounts [Healthy]');
    buffer.writeln('  🛡️ Safe Accounts (HF >= 1.05):        $safeText');

    // Protocol distribution
    final naviStr = Formatters.formatInteger(obligations.naviCount);
    final scallopStr = Formatters.formatInteger(obligations.scallopCount);
    final protoText = 'Protocols: NAVI ($naviStr) | Scallop ($scallopStr)';
    buffer.writeln('  ${Ansi.dimGray(protoText)}');

    return buffer.toString();
  }
}
