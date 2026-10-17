import 'dart:io';

/// Terminal ANSI escape codes, color palette, and terminal capability detection.
class Ansi {
  static bool colorsEnabled = true;

  /// Canonical check respecting NO_COLOR, stdout.hasTerminal, and supportsAnsiEscapes.
  static bool get useAnsi =>
      colorsEnabled &&
      stdout.hasTerminal &&
      stdout.supportsAnsiEscapes &&
      !Platform.environment.containsKey('NO_COLOR');

  // Control sequences
  static const String reset = '\x1B[0m';
  static const String bold = '\x1B[1m';
  static const String dim = '\x1B[2m';
  static const String italic = '\x1B[3m';
  static const String underline = '\x1B[4m';
  static const String blink = '\x1B[5m';
  static const String reverse = '\x1B[7m';

  // Foreground colors
  static const String black = '\x1B[30m';
  static const String red = '\x1B[31m';
  static const String green = '\x1B[32m';
  static const String yellow = '\x1B[33m';
  static const String blue = '\x1B[34m';
  static const String magenta = '\x1B[35m';
  static const String cyan = '\x1B[36m';
  static const String white = '\x1B[37m';
  static const String gray = '\x1B[90m';

  // High intensity bright foreground colors
  static const String brightRed = '\x1B[91m';
  static const String brightGreen = '\x1B[92m';
  static const String brightYellow = '\x1B[93m';
  static const String brightBlue = '\x1B[94m';
  static const String brightMagenta = '\x1B[95m';
  static const String brightCyan = '\x1B[96m';
  static const String brightWhite = '\x1B[97m';

  // Background colors
  static const String bgRed = '\x1B[41m';
  static const String bgGreen = '\x1B[42m';
  static const String bgYellow = '\x1B[43m';
  static const String bgBlue = '\x1B[44m';
  static const String bgMagenta = '\x1B[45m';
  static const String bgCyan = '\x1B[46m';
  static const String bgWhite = '\x1B[47m';

  // Screen & cursor commands
  static const String hideCursor = '\x1B[?25l';
  static const String showCursor = '\x1B[?25h';
  static const String clearScreen = '\x1B[2J\x1B[H';
  static const String clearLine = '\x1B[2K\r';
  static const String moveHome = '\x1B[H';

  static String moveTo(int row, int col) => '\x1B[$row;${col}H';

  /// Wraps [text] in [style] if ANSI is enabled, else returns [text] unmodified.
  static String style(String text, String styleCode) {
    if (!useAnsi) return text;
    return '$styleCode$text$reset';
  }

  // Pre-configured style helpers
  static String boldGreen(String text) => style(text, '$bold$brightGreen');
  static String boldYellow(String text) => style(text, '$bold$brightYellow');
  static String boldRed(String text) => style(text, '$bold$brightRed');
  static String boldCyan(String text) => style(text, '$bold$brightCyan');
  static String boldMagenta(String text) => style(text, '$bold$brightMagenta');
  static String boldWhite(String text) => style(text, '$bold$brightWhite');
  static String dimGray(String text) => style(text, dim);
  static String strikeBadge(String text) => style(text, '$bgRed$brightWhite$bold');
  static String cautionBadge(String text) => style(text, '$bgYellow$black$bold');
  static String healthyBadge(String text) => style(text, '$bgGreen$black$bold');

  /// Removes all ANSI escape codes from [input] to determine actual printable column length.
  static final RegExp _ansiRegex = RegExp(r'\x1B\[[0-?]*[ -/]*[@-~]');
  static String strip(String input) => input.replaceAll(_ansiRegex, '');

  /// Computes the visual character width of a string disregarding escape sequences.
  static int visualWidth(String input) => strip(input).length;

  /// Pads text to [width] taking visual width into account.
  static String padRight(String text, int width) {
    final vw = visualWidth(text);
    if (vw >= width) return text;
    return text + (' ' * (width - vw));
  }

  static String padLeft(String text, int width) {
    final vw = visualWidth(text);
    if (vw >= width) return text;
    return (' ' * (width - vw)) + text;
  }
}
