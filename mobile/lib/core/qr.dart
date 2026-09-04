/// A scanned card carries `https://app.netrofit.com/p/s/<token>` — the same
/// payload printed on every card and student QR. Accept that URL, any /p/s/
/// path, or a bare token pasted by hand. Null when it is none of those.
String? extractQrToken(String raw) {
  final value = raw.trim();
  if (value.isEmpty) return null;

  final uri = Uri.tryParse(value);
  if (uri != null && uri.pathSegments.length >= 3) {
    final segs = uri.pathSegments;
    final i = segs.indexOf('p');
    if (i >= 0 && segs.length > i + 2 && segs[i + 1] == 's') {
      final token = segs[i + 2];
      if (_looksLikeToken(token)) return token;
    }
  }

  if (_looksLikeToken(value)) return value;
  return null;
}

/// Tokens are 32 hex chars today (uuid with dashes stripped), but the API
/// accepts 16–64 — mirror that instead of hardcoding today's mint.
bool _looksLikeToken(String s) =>
    s.length >= 16 && s.length <= 64 && RegExp(r'^[A-Za-z0-9]+$').hasMatch(s);
