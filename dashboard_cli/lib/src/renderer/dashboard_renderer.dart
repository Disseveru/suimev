import 'package:dashboard_cli/src/models/telemetry_payload.dart';
import 'package:dashboard_cli/src/terminal/ansi.dart';
import 'components/activity_feed.dart';
import 'components/financial_card.dart';
import 'components/help_modal.dart';
import 'components/loading_view.dart';
import 'components/obligation_card.dart';
import 'components/status_card.dart';
import 'components/watchlist_table.dart';
import 'spinner.dart';

/// Top-level terminal dashboard layout renderer.
class DashboardRenderer {
  final BrailleSpinner spinner = BrailleSpinner();

  /// Renders the complete dashboard view for a valid telemetry payload.
  String render(
    TelemetryPayload payload, {
    bool compact = false,
    int width = 80,
    String? statusWarning,
  }) {
    final buffer = StringBuffer();
    final divider = '─' * (width - 4);

    // 1. Header & Engine Status Card
    buffer.writeln(StatusCard.render(payload, width: width));
    buffer.writeln();

    // 2. Operator Gas Tank & Financial PnL Overview
    buffer.writeln(FinancialCard.render(payload.operator, payload.financials, width: width));
    buffer.writeln();

    // 3. Obligation Queue Overview
    buffer.writeln(ObligationCard.render(payload.obligations, width: width));
    buffer.writeln();

    // 4. Hot Accounts Watchlist Table
    buffer.writeln(WatchlistTable.render(
      payload.hotWatchlist,
      maxItems: compact ? 3 : 5,
      width: width,
    ));

    // 5. Activity Feed (omitted in compact mode to preserve vertical space)
    if (!compact) {
      buffer.writeln();
      buffer.writeln(ActivityFeed.render(
        payload.recentLiquidations,
        maxEvents: 3,
        width: width,
      ));
    }

    // Optional status warning (e.g. temporary file lock contention)
    if (statusWarning != null && statusWarning.isNotEmpty) {
      buffer.writeln();
      buffer.writeln('  ${Ansi.boldYellow('⚠️  $statusWarning')}');
    }

    // 6. Interactive Controls Footer
    buffer.writeln();
    buffer.writeln('  $divider');
    buffer.write('  Controls: [Q] Quit   [R] Force Refresh   [C] Toggle Color Mode   [H] Help');

    return buffer.toString();
  }

  /// Renders the loading animation screen when telemetry is not yet available.
  String renderLoading({
    required String filePath,
    required String statusMessage,
    int width = 80,
  }) {
    return LoadingView.render(
      filePath: filePath,
      statusMessage: statusMessage,
      spinner: spinner,
      width: width,
    );
  }

  /// Renders the help dialog overlay.
  String renderHelp({int width = 80}) {
    return HelpModal.render(width: width);
  }
}
