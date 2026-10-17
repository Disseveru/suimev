/// Braille spinner for animated terminal waiting states.
class BrailleSpinner {
  static const List<String> frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  int _currentFrame = 0;

  String nextFrame() {
    final frame = frames[_currentFrame];
    _currentFrame = (_currentFrame + 1) % frames.length;
    return frame;
  }

  String get current => frames[_currentFrame];
}
