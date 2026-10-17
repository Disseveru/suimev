import 'package:dashboard_cli/src/cli.dart';
import 'package:dashboard_cli/src/lifecycle.dart';
import 'package:dashboard_cli/src/terminal/ansi.dart';
import 'package:dashboard_cli/src/terminal/keyboard_listener.dart';
import 'package:test/test.dart';

void main() {
  group('TerminalLifecycle & Signal Safety Tests', () {
    test('installSignalHandlers does not throw UnsupportedError on Windows', () {
      final lifecycle = TerminalLifecycle();
      bool exitTriggered = false;

      // Must not throw UnsupportedError even on Windows
      expect(
        () => lifecycle.installSignalHandlers(() {
          exitTriggered = true;
        }),
        returnsNormally,
      );

      // restoreTerminal should be clean and idempotent
      expect(() => lifecycle.restoreTerminal(), returnsNormally);
      expect(() => lifecycle.restoreTerminal(), returnsNormally);
      expect(exitTriggered, isFalse);
    });

    test('configureInteractiveTerminal does not crash when not running in interactive terminal', () {
      final lifecycle = TerminalLifecycle();
      expect(() => lifecycle.configureInteractiveTerminal(), returnsNormally);
      expect(() => lifecycle.restoreTerminal(), returnsNormally);
    });
  });

  group('KeyboardListener Tests', () {
    test('start and stop handle non-terminal environment cleanly', () async {
      bool quitCalled = false;
      bool refreshCalled = false;
      bool colorCalled = false;
      bool helpCalled = false;

      final listener = KeyboardListener(
        onQuit: () => quitCalled = true,
        onRefresh: () => refreshCalled = true,
        onToggleColor: () => colorCalled = true,
        onToggleHelp: () => helpCalled = true,
      );

      // Should not throw
      expect(() => listener.start(), returnsNormally);
      await expectLater(listener.stop(), completes);
      // Double stop should be safe
      await expectLater(listener.stop(), completes);

      expect(quitCalled, isFalse);
      expect(refreshCalled, isFalse);
      expect(colorCalled, isFalse);
      expect(helpCalled, isFalse);
    });
  });

  group('Ansi Capability & NO_COLOR Tests', () {
    tearDown(() {
      Ansi.colorsEnabled = true;
    });

    test('useAnsi is false when colorsEnabled is explicitly toggled off', () {
      Ansi.colorsEnabled = false;
      expect(Ansi.useAnsi, isFalse);
      expect(Ansi.boldGreen('Hello'), equals('Hello'));
      expect(Ansi.boldYellow('Warning'), equals('Warning'));
      expect(Ansi.boldRed('Alert'), equals('Alert'));
      expect(Ansi.strikeBadge('STRIKE'), equals('STRIKE'));
    });

    test('Ansi.visualWidth accurately handles empty, plain, and heavily styled strings', () {
      expect(Ansi.visualWidth(''), equals(0));
      expect(Ansi.visualWidth('Normal Text'), equals(11));

      // Force enable style to produce ANSI escape sequence
      const colored = '\x1B[1m\x1B[92mGreen Text\x1B[0m';
      expect(Ansi.visualWidth(colored), equals(10));

      final paddedRight = Ansi.padRight(colored, 15);
      expect(Ansi.visualWidth(paddedRight), equals(15));

      final paddedLeft = Ansi.padLeft(colored, 15);
      expect(Ansi.visualWidth(paddedLeft), equals(15));
    });
  });

  group('CLI Configuration & Path Resolution Tests', () {
    test('resolveDefaultStatePath resolves a path ending with telemetry.json', () {
      final path = resolveDefaultStatePath();
      expect(path, isNotEmpty);
      expect(path.endsWith('telemetry.json'), isTrue);
    });

    test('buildArgParser configures all expected flags and options', () {
      final parser = buildArgParser();

      expect(parser.options.containsKey('state-file'), isTrue);
      expect(parser.options['state-file']!.abbr, equals('s'));

      expect(parser.options.containsKey('refresh-interval'), isTrue);
      expect(parser.options['refresh-interval']!.abbr, equals('i'));

      expect(parser.options.containsKey('no-color'), isTrue);

      expect(parser.options.containsKey('compact'), isTrue);
      expect(parser.options['compact']!.abbr, equals('c'));

      expect(parser.options.containsKey('once'), isTrue);

      expect(parser.options.containsKey('help'), isTrue);
      expect(parser.options['help']!.abbr, equals('h'));

      expect(parser.options.containsKey('version'), isTrue);
      expect(parser.options['version']!.abbr, equals('v'));
    });
  });
}
