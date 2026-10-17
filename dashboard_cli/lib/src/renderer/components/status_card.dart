import 'package:dashboard_cli/src/models/telemetry_payload.dart';
import 'package:dashboard_cli/src/renderer/formatters.dart';
import 'package:dashboard_cli/src/terminal/ansi.dart';

/// Top header card displaying engine status, network mode, and gateway telemetry.
class StatusCard {
  static String render(TelemetryPayload payload, {int width = 80}) {
    final buffer = StringBuffer();
    final innerWidth = width - 4; // Inside border padding: "║ " and " ║"

    // Top border
    buffer.writeln('╔${'═' * (width - 2)}╗');

    // Status indicator styling
    String statusIndicator;
    if (payload.isOnline) {
      statusIndicator = Ansi.boldGreen('● LIVE ENGINE ONLINE');
    } else if (payload.isPaused) {
      statusIndicator = Ansi.boldYellow('● ENGINE PAUSED');
    } else {
      statusIndicator = Ansi.boldRed('● ENGINE ERROR / OFFLINE');
    }

    final modeBadge = payload.mode == 'dryRun'
        ? Ansi.boldCyan('[SIMULATION / DRY-RUN]')
        : Ansi.boldMagenta('[MAINNET LIVE]');

    // First line: Title, Status, Mode
    final title = Ansi.boldWhite('⚡ SuiMEV LIQUIDATION MONITOR');
    final leftPart = '$title  $statusIndicator';
    final line1 = _buildPaddedLine(leftPart, modeBadge, innerWidth);
    buffer.writeln('║ $line1 ║');

    // Second line: Uptime, Gateway, Updated
    final uptime = payload.formattedUptime.isNotEmpty
        ? 'Uptime: ${payload.formattedUptime}'
        : 'Engine: Active';
    final gateway = payload.rpcEndpoint != null
        ? 'Gateway: ${payload.rpcEndpoint}'
        : 'Network: ${payload.network ?? 'mainnet'}';
    final updated = 'Updated: ${Formatters.timeAgo(payload.timestamp)}';

    final metaLeft = Ansi.dimGray('$uptime    $gateway');
    final metaRight = Ansi.dimGray(updated);
    final line2 = _buildPaddedLine(metaLeft, metaRight, innerWidth);
    buffer.writeln('║ $line2 ║');

    // Bottom border
    buffer.write('╚${'═' * (width - 2)}╝');

    return buffer.toString();
  }

  static String _buildPaddedLine(String left, String right, int targetWidth) {
    final int leftWidth = Ansi.visualWidth(left);
    final int rightWidth = Ansi.visualWidth(right);
    final int spaceNeeded = targetWidth - (leftWidth + rightWidth);

    if (spaceNeeded <= 0) {
      return '$left $right';
    }
    return '$left${' ' * spaceNeeded}$right';
  }
}
