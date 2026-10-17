import 'package:dashboard_cli/src/renderer/spinner.dart';
import 'package:dashboard_cli/src/terminal/ansi.dart';

/// Renders a friendly loading state when telemetry file is missing or waiting for engine startup.
class LoadingView {
  static String render({
    required String filePath,
    required String statusMessage,
    required BrailleSpinner spinner,
    int width = 80,
  }) {
    final buffer = StringBuffer();
    final divider = '─' * (width - 4);

    // Header banner
    buffer.writeln('╔${'═' * (width - 2)}╗');
    final title = Ansi.boldWhite('⚡ SuiMEV LIQUIDATION MONITOR');
    final tag = Ansi.boldYellow('[WAITING FOR ENGINE]');
    final titleLine = Ansi.padRight('$title  $tag', width - 4);
    buffer.writeln('║ $titleLine ║');
    buffer.writeln('╚${'═' * (width - 2)}╝');
    buffer.writeln();

    // Spinner and status message
    final spChar = Ansi.boldCyan(spinner.nextFrame());
    buffer.writeln('   $spChar ${Ansi.boldWhite('Connecting to SuiMEV liquidator engine...')}');
    buffer.writeln('     ${Ansi.dimGray('Target state file:')} $filePath');
    buffer.writeln('     ${Ansi.dimGray('Status:')} $statusMessage');
    buffer.writeln();
    buffer.writeln('     ${Ansi.dimGray('(The dashboard will automatically refresh the instant the engine starts)')}');
    buffer.writeln();
    buffer.writeln('  $divider');
    buffer.writeln('  Controls: [Q] Quit   [R] Force Check Now   [C] Toggle Color');

    return buffer.toString();
  }
}
