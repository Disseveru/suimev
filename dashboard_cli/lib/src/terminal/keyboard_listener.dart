import 'dart:async';
import 'dart:io';

/// Listens for non-blocking interactive key presses (`q`, `r`, `c`, `h`).
class KeyboardListener {
  final void Function() onQuit;
  final void Function() onRefresh;
  final void Function() onToggleColor;
  final void Function() onToggleHelp;

  StreamSubscription<List<int>>? _stdinSub;

  KeyboardListener({
    required this.onQuit,
    required this.onRefresh,
    required this.onToggleColor,
    required this.onToggleHelp,
  });

  /// Starts listening to stdin keystrokes if a terminal is attached.
  void start() {
    if (!stdin.hasTerminal) return;

    try {
      _stdinSub = stdin.listen((List<int> bytes) {
        if (bytes.isEmpty) return;

        // Check for ASCII characters
        for (final byte in bytes) {
          // Ctrl+C is byte 3
          if (byte == 3) {
            onQuit();
            return;
          }

          final char = String.fromCharCode(byte).toLowerCase();
          switch (char) {
            case 'q':
              onQuit();
              return;
            case 'r':
              onRefresh();
              break;
            case 'c':
              onToggleColor();
              break;
            case 'h':
            case '?':
              onToggleHelp();
              break;
          }
        }
      });
    } catch (_) {
      // In non-interactive contexts or test suites, ignore
    }
  }

  /// Cancels the input stream subscription.
  Future<void> stop() async {
    await _stdinSub?.cancel();
    _stdinSub = null;
  }
}
