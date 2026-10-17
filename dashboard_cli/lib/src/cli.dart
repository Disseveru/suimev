import 'dart:async';
import 'dart:io';

import 'package:args/args.dart';
import 'package:io/io.dart';
import 'package:path/path.dart' as p;

import 'lifecycle.dart';
import 'poller/telemetry_reader.dart';
import 'renderer/dashboard_renderer.dart';
import 'terminal/ansi.dart';
import 'terminal/keyboard_listener.dart';

const String cliVersion = '1.0.0';

/// Resolves standard default path for telemetry file depending on current working directory.
String resolveDefaultStatePath() {
  final cwdDirect = p.join(Directory.current.path, '.state', 'telemetry.json');
  if (File(cwdDirect).existsSync()) return cwdDirect;

  final parentDirect = p.join(Directory.current.path, '..', '.state', 'telemetry.json');
  if (File(parentDirect).existsSync()) return parentDirect;

  return cwdDirect;
}

/// Constructs the CLI ArgParser with type-safe options and flags.
ArgParser buildArgParser() {
  return ArgParser()
    ..addOption(
      'state-file',
      abbr: 's',
      help: 'Path to the engine telemetry JSON snapshot file.',
      defaultsTo: resolveDefaultStatePath(),
    )
    ..addOption(
      'refresh-interval',
      abbr: 'i',
      help: 'Telemetry polling and refresh interval in milliseconds (min 100ms).',
      defaultsTo: '1000',
    )
    ..addFlag(
      'no-color',
      help: 'Explicitly disable ANSI colors and terminal styling.',
      negatable: false,
    )
    ..addFlag(
      'compact',
      abbr: 'c',
      help: 'Render a compact layout suitable for smaller terminal windows.',
      negatable: false,
    )
    ..addFlag(
      'once',
      help: 'Render a single telemetry snapshot to stdout and exit immediately.',
      negatable: false,
    )
    ..addFlag(
      'help',
      abbr: 'h',
      help: 'Show this help and usage documentation.',
      negatable: false,
    )
    ..addFlag(
      'version',
      abbr: 'v',
      help: 'Show the dashboard CLI version.',
      negatable: false,
    );
}

/// Main CLI execution entrypoint returning a standard POSIX exit code.
Future<int> runCli(
  List<String> args, {
  StringSink? outSink,
  StringSink? errSink,
}) async {
  final stdoutSink = outSink ?? stdout;
  final stderrSink = errSink ?? stderr;
  final parser = buildArgParser();

  ArgResults results;
  try {
    results = parser.parse(args);
  } on FormatException catch (e) {
    stderrSink.writeln('Error: ${e.message}');
    stderrSink.writeln();
    stderrSink.writeln('Usage: dashboard [options]');
    stderrSink.writeln(parser.usage);
    return ExitCode.usage.code;
  }

  // Handle --help
  if (results.flag('help')) {
    stdoutSink.writeln('SuiMEV Liquidator Bot - Terminal Live Feed Dashboard (v$cliVersion)');
    stdoutSink.writeln();
    stdoutSink.writeln('Usage: dashboard [options]');
    stdoutSink.writeln(parser.usage);
    stdoutSink.writeln();
    stdoutSink.writeln('Interactive Keys:');
    stdoutSink.writeln('  q  Quit dashboard');
    stdoutSink.writeln('  r  Force immediate refresh');
    stdoutSink.writeln('  c  Toggle ANSI color mode');
    stdoutSink.writeln('  h  Toggle operator help overlay');
    return ExitCode.success.code;
  }

  // Handle --version
  if (results.flag('version')) {
    stdoutSink.writeln('dashboard_cli version $cliVersion');
    return ExitCode.success.code;
  }

  // Validate --refresh-interval
  final intervalStr = results.option('refresh-interval') ?? '1000';
  final int refreshInterval;
  try {
    refreshInterval = int.parse(intervalStr);
    if (refreshInterval < 100) {
      throw const FormatException('Refresh interval cannot be less than 100ms');
    }
  } on FormatException catch (e) {
    stderrSink.writeln('Error: Invalid --refresh-interval: ${e.message}');
    stderrSink.writeln();
    stderrSink.writeln('Usage: dashboard [options]');
    stderrSink.writeln(parser.usage);
    return ExitCode.usage.code;
  }

  // Handle --no-color
  if (results.flag('no-color')) {
    Ansi.colorsEnabled = false;
  }

  final stateFilePath = results.option('state-file') ?? resolveDefaultStatePath();
  final stateFile = File(stateFilePath);
  final compact = results.flag('compact');
  final once = results.flag('once');

  final reader = TelemetryReader(file: stateFile);
  final renderer = DashboardRenderer();

  // If --once is passed, read once and output to stdout without entering loop
  if (once) {
    final result = await reader.readLatest(force: true);
    if (result.isLoading || result.payload == null) {
      stdoutSink.writeln(renderer.renderLoading(
        filePath: stateFile.path,
        statusMessage: result.statusMessage ?? 'Waiting for state file...',
      ));
    } else {
      stdoutSink.writeln(renderer.render(
        result.payload!,
        compact: compact,
        statusWarning: result.statusMessage,
      ));
    }
    return ExitCode.success.code;
  }

  // Full interactive live feed session
  final lifecycle = TerminalLifecycle();
  final exitCompleter = Completer<int>();
  bool isHelpOverlayActive = false;
  Timer? pollTimer;

  void triggerExit([int code = 0]) {
    if (!exitCompleter.isCompleted) {
      exitCompleter.complete(code);
    }
  }

  lifecycle.installSignalHandlers(() => triggerExit(ExitCode.success.code));
  lifecycle.configureInteractiveTerminal();

  Future<void> redrawScreen({bool forceDiskRead = false}) async {
    if (exitCompleter.isCompleted) return;

    if (isHelpOverlayActive) {
      if (Ansi.useAnsi) {
        stdoutSink.write(Ansi.clearScreen);
      }
      stdoutSink.writeln(renderer.renderHelp());
      return;
    }

    final result = await reader.readLatest(force: forceDiskRead);

    if (Ansi.useAnsi) {
      stdoutSink.write(Ansi.clearScreen);
    }

    if (result.isLoading || result.payload == null) {
      stdoutSink.writeln(renderer.renderLoading(
        filePath: stateFile.path,
        statusMessage: result.statusMessage ?? 'Waiting for state snapshot...',
      ));
    } else {
      stdoutSink.writeln(renderer.render(
        result.payload!,
        compact: compact,
        statusWarning: result.statusMessage,
      ));
    }
  }

  final keyboard = KeyboardListener(
    onQuit: () => triggerExit(ExitCode.success.code),
    onRefresh: () async {
      await redrawScreen(forceDiskRead: true);
    },
    onToggleColor: () async {
      Ansi.colorsEnabled = !Ansi.colorsEnabled;
      await redrawScreen();
    },
    onToggleHelp: () async {
      isHelpOverlayActive = !isHelpOverlayActive;
      await redrawScreen();
    },
  );

  keyboard.start();

  // Initial render
  await redrawScreen(forceDiskRead: true);

  // Setup periodic polling timer
  pollTimer = Timer.periodic(Duration(milliseconds: refreshInterval), (_) async {
    await redrawScreen();
  });

  try {
    return await exitCompleter.future;
  } finally {
    pollTimer.cancel();
    await keyboard.stop();
    lifecycle.restoreTerminal();
  }
}
