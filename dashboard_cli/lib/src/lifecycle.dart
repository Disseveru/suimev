import 'dart:async';
import 'dart:io';

import 'terminal/ansi.dart';

/// Manages cross-platform process lifecycle, terminal modes, and non-destructive exit teardown.
class TerminalLifecycle {
  StreamSubscription<ProcessSignal>? _sigintSub;
  StreamSubscription<ProcessSignal>? _sigtermSub;
  bool _isCleanedUp = false;
  bool _rawModeConfigured = false;

  /// Installs signal handlers for graceful shutdown across Windows and POSIX platforms.
  void installSignalHandlers(void Function() onExitRequested) {
    try {
      _sigintSub = ProcessSignal.sigint.watch().listen((_) {
        onExitRequested();
      });
    } catch (_) {
      // In non-interactive test harnesses, watch() may throw
    }

    // CRITICAL: Windows throws UnsupportedError on sigterm.watch()
    if (!Platform.isWindows) {
      try {
        _sigtermSub = ProcessSignal.sigterm.watch().listen((_) {
          onExitRequested();
        });
      } catch (_) {}
    }
  }

  /// Configures standard input for single-keystroke interactive reading without echo.
  void configureInteractiveTerminal() {
    if (!stdin.hasTerminal) return;
    try {
      stdin.echoMode = false;
      stdin.lineMode = false;
      _rawModeConfigured = true;
    } catch (_) {
      // Gracefully ignore if environment restricts terminal mode mutation
    }

    if (Ansi.useAnsi) {
      stdout.write(Ansi.hideCursor);
    }
  }

  /// Restores terminal echo, line buffering, and cursor visibility.
  void restoreTerminal() {
    if (_isCleanedUp) return;
    _isCleanedUp = true;

    try {
      _sigintSub?.cancel();
      _sigtermSub?.cancel();
    } catch (_) {}

    if (stdin.hasTerminal && _rawModeConfigured) {
      try {
        stdin.lineMode = true;
        stdin.echoMode = true;
      } catch (_) {}
    }

    if (Ansi.useAnsi) {
      try {
        stdout.write('${Ansi.showCursor}\n');
      } catch (_) {}
    }
  }
}
