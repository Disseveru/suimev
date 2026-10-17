/// Formatting helpers for currency, quantities, and terminal layout borders.
class Formatters {
  /// Formats an integer with thousands comma separators (e.g. 1240 -> "1,240").
  static String formatInteger(int value) {
    final str = value.toString();
    final buffer = StringBuffer();
    final len = str.length;
    for (int i = 0; i < len; i++) {
      if (i > 0 && (len - i) % 3 == 0) {
        buffer.write(',');
      }
      buffer.write(str[i]);
    }
    return buffer.toString();
  }

  /// Formats a USD currency amount with commas and 2 decimals (e.g. 12450.5 -> "$12,450.50").
  static String formatUsd(double amount) {
    final isNegative = amount < 0;
    final absAmount = amount.abs();
    final parts = absAmount.toStringAsFixed(2).split('.');
    final integerPart = formatInteger(int.parse(parts[0]));
    final decimalPart = parts[1];
    return '${isNegative ? '-' : ''}\$$integerPart.$decimalPart';
  }

  /// Formats signed USD currency (e.g. 1245.5 -> "+$1,245.50 USD").
  static String formatSignedUsd(double amount) {
    final sign = amount >= 0 ? '+' : '-';
    final absAmount = amount.abs();
    final parts = absAmount.toStringAsFixed(2).split('.');
    final integerPart = formatInteger(int.parse(parts[0]));
    final decimalPart = parts[1];
    return '$sign\$$integerPart.$decimalPart USD';
  }

  /// Formats SUI coin amount with 4 decimal places.
  static String formatSui(double amount) {
    final parts = amount.toStringAsFixed(4).split('.');
    final integerPart = formatInteger(int.parse(parts[0]));
    return '$integerPart.${parts[1]} SUI';
  }

  /// Human-friendly relative timestamp (e.g. "2s ago", "1m ago").
  static String timeAgo(DateTime timestamp) {
    final now = DateTime.now();
    final diff = now.difference(timestamp);

    if (diff.inSeconds < 2) return 'just now';
    if (diff.inSeconds < 60) return '${diff.inSeconds}s ago';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }
}
