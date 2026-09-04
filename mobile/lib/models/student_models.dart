/// Models for the student's half of the app, mirroring /api/student and
/// /api/student-auth exactly as the web exam portal consumes them.
library;

List<Map<String, dynamic>> _list(dynamic v) =>
    (v as List?)?.whereType<Map<String, dynamic>>().toList() ?? const [];

class StudentInfo {
  StudentInfo({required this.name, required this.username});

  final String name;
  final String username;

  factory StudentInfo.fromJson(Map<String, dynamic> j) => StudentInfo(
        name: (j['name'] as String?) ?? '',
        username: (j['username'] as String?) ?? '',
      );
}

class ClaimStart {
  ClaimStart({
    required this.studentName,
    required this.hasCredentials,
    required this.claimTicket,
  });

  final String studentName;

  /// True when the card was claimed before — the student signs in with the
  /// credentials they already set, false means they are choosing them now.
  final bool hasCredentials;
  final String claimTicket;

  factory ClaimStart.fromJson(Map<String, dynamic> j) => ClaimStart(
        studentName: (j['studentName'] as String?) ?? '',
        hasCredentials: j['hasCredentials'] == true,
        claimTicket: (j['claimTicket'] as String?) ?? '',
      );
}

/// AVAILABLE | IN_PROGRESS | DONE — the exam list groups by this.
class ExamListItem {
  ExamListItem({
    required this.examId,
    required this.name,
    required this.courseName,
    required this.questionCount,
    required this.durationMinutes,
    required this.closesAt,
    required this.requiresCode,
    required this.state,
    required this.score,
    required this.total,
  });

  final String examId;
  final String name;
  final String courseName;
  final int? questionCount;
  final int? durationMinutes;
  final String? closesAt;
  final bool requiresCode;
  final String state;
  final double? score;
  final double? total;

  factory ExamListItem.fromJson(Map<String, dynamic> j) => ExamListItem(
        examId: (j['examId'] as String?) ?? '',
        name: (j['name'] as String?) ?? '',
        courseName: (j['courseName'] as String?) ?? '',
        questionCount: (j['questionCount'] as num?)?.toInt(),
        durationMinutes: (j['durationMinutes'] as num?)?.toInt(),
        closesAt: j['closesAt'] as String?,
        requiresCode: j['requiresCode'] == true,
        state: (j['state'] as String?) ?? 'AVAILABLE',
        score: (j['score'] as num?)?.toDouble(),
        total: (j['total'] as num?)?.toDouble(),
      );
}

class PaperOption {
  PaperOption({required this.id, required this.text});

  final String id;
  final String text;

  factory PaperOption.fromJson(Map<String, dynamic> j) => PaperOption(
        id: (j['id'] as String?) ?? '',
        text: (j['text'] as String?) ?? '',
      );
}

class PaperQuestion {
  PaperQuestion({
    required this.id,
    required this.orderIndex,
    required this.questionText,
    required this.options,
    required this.selectedOptionId,
  });

  final String id;
  final int orderIndex;
  final String questionText;
  final List<PaperOption> options;

  /// Mutable: the sitting screen records the pick locally the moment it is
  /// saved server-side, so a resumed attempt paints the same paper.
  String? selectedOptionId;

  factory PaperQuestion.fromJson(Map<String, dynamic> j) => PaperQuestion(
        id: (j['id'] as String?) ?? '',
        orderIndex: (j['orderIndex'] as num?)?.toInt() ?? 0,
        questionText: (j['questionText'] as String?) ?? '',
        options: _list(j['options']).map(PaperOption.fromJson).toList(),
        selectedOptionId: j['selectedOptionId'] as String?,
      );
}

class StudentAttempt {
  StudentAttempt({
    required this.examName,
    required this.durationMinutes,
    required this.questions,
    required this.remaining,
  });

  final String examName;
  final int? durationMinutes;
  final List<PaperQuestion> questions;

  /// Time left, computed against the SERVER clock at fetch time — the phone's
  /// own clock never decides when a paper closes. Null = untimed.
  final Duration? remaining;

  factory StudentAttempt.fromJson(Map<String, dynamic> j) {
    final exam = (j['exam'] as Map<String, dynamic>?) ?? const {};
    Duration? remaining;
    final expires = DateTime.tryParse((j['expiresAt'] as String?) ?? '');
    final serverNow = DateTime.tryParse((j['serverNow'] as String?) ?? '');
    if (expires != null && serverNow != null) {
      final d = expires.difference(serverNow);
      remaining = d.isNegative ? Duration.zero : d;
    }
    return StudentAttempt(
      examName: (exam['name'] as String?) ?? '',
      durationMinutes: (exam['durationMinutes'] as num?)?.toInt(),
      questions: _list(j['questions']).map(PaperQuestion.fromJson).toList(),
      remaining: remaining,
    );
  }
}

class ReviewQuestion {
  ReviewQuestion({
    required this.questionText,
    required this.explanation,
    required this.options,
    required this.selectedOptionId,
    required this.isCorrect,
  });

  final String questionText;
  final String? explanation;
  final List<ReviewOption> options;
  final String? selectedOptionId;
  final bool isCorrect;

  factory ReviewQuestion.fromJson(Map<String, dynamic> j) => ReviewQuestion(
        questionText: (j['questionText'] as String?) ?? '',
        explanation: j['explanation'] as String?,
        options: _list(j['options']).map(ReviewOption.fromJson).toList(),
        selectedOptionId: j['selectedOptionId'] as String?,
        isCorrect: j['isCorrect'] == true,
      );
}

class ReviewOption {
  ReviewOption({required this.id, required this.text, required this.isCorrect});

  final String id;
  final String text;
  final bool isCorrect;

  factory ReviewOption.fromJson(Map<String, dynamic> j) => ReviewOption(
        id: (j['id'] as String?) ?? '',
        text: (j['text'] as String?) ?? '',
        isCorrect: j['isCorrect'] == true,
      );
}

class SubmitResult {
  SubmitResult({
    required this.score,
    required this.total,
    required this.showAnswers,
    required this.questions,
  });

  final double score;
  final double total;

  /// The teacher decides per exam whether students may review the answers.
  final bool showAnswers;
  final List<ReviewQuestion> questions;

  factory SubmitResult.fromJson(Map<String, dynamic> j) => SubmitResult(
        score: (j['score'] as num?)?.toDouble() ?? 0,
        total: (j['total'] as num?)?.toDouble() ?? 0,
        showAnswers: j['showAnswers'] == true,
        questions: _list(j['questions']).map(ReviewQuestion.fromJson).toList(),
      );
}

class ResultRow {
  ResultRow({
    required this.examName,
    required this.courseName,
    required this.examDate,
    required this.grade,
    required this.maxGrade,
    required this.isHomework,
    required this.isRating,
    required this.isAbsent,
    required this.notMarked,
  });

  final String examName;
  final String courseName;
  final String? examDate;
  final String grade;
  final double? maxGrade;
  final bool isHomework;
  final bool isRating;
  final bool isAbsent;
  final bool notMarked;

  factory ResultRow.fromJson(Map<String, dynamic> j) => ResultRow(
        examName: (j['examName'] as String?) ?? '',
        courseName: (j['courseName'] as String?) ?? '',
        examDate: j['examDate'] as String?,
        grade: (j['grade'] as String?) ?? '',
        maxGrade: (j['maxGrade'] as num?)?.toDouble(),
        isHomework: j['isHomework'] == true,
        isRating: j['isRating'] == true,
        isAbsent: j['isAbsent'] == true,
        notMarked: j['notMarked'] == true,
      );
}
