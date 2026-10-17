import 'package:dashboard_cli/src/terminal/ansi.dart';

/// Interactive help overlay explaining controls and color semantics for operators.
class HelpModal {
  static String render({int width = 80}) {
    final buffer = StringBuffer();
    final divider = '─' * (width - 4);

    buffer.writeln('╔${'═' * (width - 2)}╗');
    final title = Ansi.boldWhite('📖 DASHBOARD HELP & OPERATOR QUICK REFERENCE');
    final line = Ansi.padRight(title, width - 4);
    buffer.writeln('║ $line ║');
    buffer.writeln('╚${'═' * (width - 2)}╝');
    buffer.writeln();

    buffer.writeln('  ${Ansi.boldWhite('KEYBOARD CONTROLS')}');
    buffer.writeln('  $divider');
    buffer.writeln('  [Q] or [Ctrl+C]    Gracefully exit dashboard (restoring terminal)');
    buffer.writeln('  [R]                Force immediate file read & UI refresh');
    buffer.writeln('  [C]                Toggle ANSI color styling on/off');
    buffer.writeln('  [H] or [?]         Toggle this help screen on/off');
    buffer.writeln();

    buffer.writeln('  ${Ansi.boldWhite('COLOR CODING & RISK TIERS')}');
    buffer.writeln('  $divider');
    buffer.writeln('  ${Ansi.boldRed('RED [STRIKE]')}        Health Factor < 1.0000: Defaulted, eligible for zero-capital PTB strike');
    buffer.writeln('  ${Ansi.boldYellow('YELLOW [HOT]')}       1.0000 <= HF < 1.0500: Near strike, active sub-second surveillance');
    buffer.writeln('  ${Ansi.boldGreen('GREEN [SAFE]')}       HF >= 1.0500: Fully collateralized healthy loan position');
    buffer.writeln('  ${Ansi.boldGreen('PNL GREEN')}          Net positive realized profit from liquidations');
    buffer.writeln('  ${Ansi.boldRed('GAS RED')}            Operator gas tank < 0.1 SUI (insufficient to submit consensus PTBs)');
    buffer.writeln();

    buffer.writeln('  $divider');
    buffer.writeln('  Press [H] or any key to return to live dashboard...');

    return buffer.toString();
  }
}
