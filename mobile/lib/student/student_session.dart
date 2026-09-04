import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api.dart';
import '../models/student_models.dart';

const _kTokenKey = 'netrofit.student.token';

/// The student's session and nothing else: a 12-hour Bearer token plus the
/// signed-in student's name. Any 401 anywhere ends it — the exam endpoints
/// keep saved answers server-side, so being bounced to login loses nothing.
class StudentSession extends ChangeNotifier {
  StudentSession(this.api);

  final ApiClient api;

  StudentInfo? _student;
  bool _ready = false;

  StudentInfo? get student => _student;
  bool get ready => _ready;
  bool get signedIn => api.token != null;

  /// Re-validate the stored token against /me on app start.
  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_kTokenKey);
    if (stored == null) {
      _ready = true;
      notifyListeners();
      return;
    }
    api.token = stored;
    try {
      final me = await api.get('/student-auth/me') as Map<String, dynamic>;
      _student = StudentInfo.fromJson(me);
    } catch (_) {
      await _clear();
    }
    _ready = true;
    notifyListeners();
  }

  Future<void> login(String identifier, String password) async {
    final res = await api.post('/student-auth/login', {
      'identifier': identifier,
      'password': password,
    }) as Map<String, dynamic>;
    await _setSession(res);
  }

  /// First step of claiming a card: prove the physical card, get a short-lived
  /// ticket plus whether this student already chose credentials.
  Future<ClaimStart> claimStart(String qrToken) async {
    final res = await api.post('/student-auth/claim-start', {'qrToken': qrToken})
        as Map<String, dynamic>;
    return ClaimStart.fromJson(res);
  }

  Future<void> claimFinish(
      String claimTicket, String username, String password) async {
    final res = await api.post('/student-auth/claim-finish', {
      'claimTicket': claimTicket,
      'username': username,
      'password': password,
    }) as Map<String, dynamic>;
    await _setSession(res);
  }

  Future<void> logout() async {
    await _clear();
    notifyListeners();
  }

  /// Called by screens when any student call answers 401 mid-session.
  Future<void> expire() => logout();

  Future<void> _setSession(Map<String, dynamic> res) async {
    api.token = res['token'] as String?;
    _student = StudentInfo.fromJson(
        (res['student'] as Map<String, dynamic>?) ?? const {});
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kTokenKey, api.token ?? '');
    notifyListeners();
  }

  Future<void> _clear() async {
    api.token = null;
    _student = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kTokenKey);
  }
}

/// The exam API, thin: every screen owns its own loading state.
class StudentExamsApi {
  StudentExamsApi(this.api);

  final ApiClient api;

  Future<List<ExamListItem>> list() async {
    final res = await api.get('/student/exams') as List;
    return res
        .whereType<Map<String, dynamic>>()
        .map(ExamListItem.fromJson)
        .toList();
  }

  Future<List<ResultRow>> results() async {
    final res = await api.get('/student/results') as List;
    return res.whereType<Map<String, dynamic>>().map(ResultRow.fromJson).toList();
  }

  Future<StudentAttempt> start(String examId, {String? accessCode}) async {
    final res = await api.post('/student/exams/$examId/start', {
      if (accessCode != null && accessCode.isNotEmpty) 'accessCode': accessCode,
    }) as Map<String, dynamic>;
    return StudentAttempt.fromJson(res);
  }

  Future<StudentAttempt> attempt(String examId) async {
    final res =
        await api.get('/student/exams/$examId/attempt') as Map<String, dynamic>;
    return StudentAttempt.fromJson(res);
  }

  Future<void> answer(String examId, String questionId, String optionId) async {
    await api.post('/student/exams/$examId/answer', {
      'questionId': questionId,
      'optionId': optionId,
    });
  }

  Future<SubmitResult> submit(String examId) async {
    final res =
        await api.post('/student/exams/$examId/submit', {}) as Map<String, dynamic>;
    return SubmitResult.fromJson(res);
  }
}
