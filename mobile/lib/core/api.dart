import 'dart:convert';

import 'package:http/http.dart' as http;

/// The production API, reached exactly the way the web apps reach it: through
/// the CloudFront distribution that proxies /api/* to API Gateway. One base for
/// both audiences — the parent endpoints are public (the QR token is the
/// credential) and the student endpoints ride a Bearer token.
const String kApiBase = 'https://app.netrofit.com/api';

/// A server-side refusal, carrying the API's own message so screens can show
/// the real reason instead of a generic "something went wrong".
class ApiException implements Exception {
  ApiException(this.statusCode, this.message, {this.code});

  final int statusCode;
  final String message;

  /// The stable dotted key (e.g. ERRORS.EXAMS.ALREADY_SUBMITTED) when the API
  /// sent one — screens branch on this, never on the human sentence.
  final String? code;

  bool get isUnauthorized => statusCode == 401;

  @override
  String toString() => message;
}

/// Thin JSON client. No retries, no caching — every screen that calls it
/// already owns a loading/error state, and stale data is worse than a spinner
/// for both a worried parent and a student mid-exam.
class ApiClient {
  ApiClient({http.Client? inner}) : _inner = inner ?? http.Client();

  final http.Client _inner;

  /// Bearer token for the student session; null for the parent flow.
  String? token;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Accept-Language': 'ar',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Future<dynamic> get(String path) async {
    final res = await _inner.get(Uri.parse('$kApiBase$path'), headers: _headers);
    return _decode(res);
  }

  Future<dynamic> post(String path, Map<String, dynamic> body) async {
    final res = await _inner.post(
      Uri.parse('$kApiBase$path'),
      headers: _headers,
      body: jsonEncode(body),
    );
    return _decode(res);
  }

  dynamic _decode(http.Response res) {
    final body = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    if (res.statusCode >= 200 && res.statusCode < 300) return body;

    final map = body is Map<String, dynamic> ? body : const <String, dynamic>{};
    throw ApiException(
      res.statusCode,
      (map['message'] as String?) ?? 'تعذر الاتصال بالخادم',
      code: map['code'] as String?,
    );
  }
}
