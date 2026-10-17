import 'package:dashboard_cli/src/models/financial_state.dart';
import 'package:dashboard_cli/src/models/operator_state.dart';
import 'package:dashboard_cli/src/renderer/formatters.dart';
import 'package:dashboard_cli/src/terminal/ansi.dart';

/// Financial metrics overview: operator gas tank balance, net PnL, and liquidation performance.
class FinancialCard {
  static String render(
    OperatorState operator,
    FinancialState financials, {
    int width = 80,
  }) {
    final buffer = StringBuffer();
    final divider = '─' * (width - 4);

    buffer.writeln('  ${Ansi.boldWhite('OPERATOR GAS TANK & REALIZED PnL')}');
    buffer.writeln('  $divider');

    // Gas balance label and Net profit
    final gasUsdStr = operator.gasBalanceUsd != null
        ? ' (${operator.formattedUsd})'
        : '';
    final gasBalanceLine = 'Gas Balance: ${Ansi.boldCyan('${operator.formattedSui}$gasUsdStr')}';

    final pnlFormatted = financials.netRealizedPnlUsd >= 0
        ? Ansi.boldGreen(Formatters.formatSignedUsd(financials.netRealizedPnlUsd))
        : Ansi.boldRed(Formatters.formatSignedUsd(financials.netRealizedPnlUsd));
    final pnlLine = 'Net Realized Profit: $pnlFormatted';

    buffer.writeln('  ${_padColumns(gasBalanceLine, pnlLine, width - 4)}');

    // Cumulative Gas spent and Total liquidations
    final gasSpentLine = 'Cumulative Gas Spent: ${financials.formattedGasSpent}';

    final totalLiqs = financials.totalLiquidationsAttempted ??
        (financials.successfulLiquidations + financials.failedLiquidations);
    final liqText = '$totalLiqs attempted (${financials.successfulLiquidations} success, ${financials.failedLiquidations} failed)';
    final liqLine = 'Liquidations: ${financials.successfulLiquidations > 0 ? Ansi.boldGreen(liqText) : liqText}';

    buffer.writeln('  ${_padColumns(gasSpentLine, liqLine, width - 4)}');

    // Gas tank status and simulations
    String gasStatusBadge;
    if (operator.gasBalanceSui >= 1.0) {
      gasStatusBadge = Ansi.boldGreen('● SUFFICIENT');
    } else if (operator.gasBalanceSui >= 0.1) {
      gasStatusBadge = Ansi.boldYellow('● LOW (REFILL SOON)');
    } else {
      gasStatusBadge = Ansi.boldRed('● CRITICAL (INSUFFICIENT)');
    }
    final gasStatusLine = 'Gas Tank Status: $gasStatusBadge (${operator.shortAddress})';

    final simText = financials.successfulSimulations != null
        ? '${financials.successfulSimulations} passed / ${financials.totalSimulations} total'
        : '${financials.totalSimulations} total checks';
    final simLine = 'Simulations: $simText';

    buffer.writeln('  ${_padColumns(gasStatusLine, simLine, width - 4)}');

    return buffer.toString();
  }

  static String _padColumns(String left, String right, int totalWidth) {
    final int leftWidth = Ansi.visualWidth(left);
    final int rightWidth = Ansi.visualWidth(right);
    final int space = totalWidth - (leftWidth + rightWidth);

    if (space <= 2) {
      return '$left  $right';
    }
    return '$left${' ' * space}$right';
  }
}
