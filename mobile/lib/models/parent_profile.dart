/// The public student profile behind a scanned card — everything a parent may
/// see, exactly as GET /api/public/students/:qrToken returns it. Parsing is
/// defensive throughout: this endpoint has grown for two years and older/newer
/// fields come and go as optional.
class ParentProfile {
  ParentProfile({
    required this.studentName,
    required this.branchName,
    required this.academyName,
    required this.courses,
    required this.attendance,
    required this.exams,
    required this.payments,
    required this.notes,
  });

  final String studentName;
  final String branchName;
  final String academyName;
  final List<CourseRow> courses;
  final AttendanceSummary attendance;
  final List<ExamRow> exams;
  final PaymentsSummary? payments;

  /// Teachers' follow-up notes the academy chose to show the family, newest
  /// first. Empty on an API build that predates them.
  final List<NoteRow> notes;

  factory ParentProfile.fromJson(Map<String, dynamic> json) {
    final student = (json['student'] as Map<String, dynamic>?) ?? const {};
    return ParentProfile(
      studentName: (student['name'] as String?) ?? '',
      branchName: (student['branchName'] as String?) ?? '',
      academyName: (student['academyName'] as String?) ?? '',
      courses: _list(json['courses']).map(CourseRow.fromJson).toList(),
      attendance: AttendanceSummary.fromJson(
          (json['attendance'] as Map<String, dynamic>?) ?? const {}),
      exams: _list(json['exams']).map(ExamRow.fromJson).toList(),
      payments: json['payments'] is Map<String, dynamic>
          ? PaymentsSummary.fromJson(json['payments'] as Map<String, dynamic>)
          : null,
      notes: _list(json['notes']).map(NoteRow.fromJson).toList(),
    );
  }
}

/// One follow-up note from a teacher. `kind` is NOTE | PRAISE | CONCERN.
class NoteRow {
  NoteRow({
    required this.id,
    required this.kind,
    required this.body,
    required this.authorName,
    required this.createdAt,
  });

  final String id;
  final String kind;
  final String body;
  final String authorName;
  final String createdAt;

  factory NoteRow.fromJson(Map<String, dynamic> j) => NoteRow(
        id: (j['id'] as String?) ?? '',
        kind: (j['kind'] as String?) ?? 'NOTE',
        body: (j['body'] as String?) ?? '',
        authorName: (j['authorName'] as String?) ?? '',
        createdAt: (j['createdAt'] as String?) ?? '',
      );
}

List<Map<String, dynamic>> _list(dynamic v) =>
    (v as List?)?.whereType<Map<String, dynamic>>().toList() ?? const [];

double _num(dynamic v) => v is num ? v.toDouble() : 0;

class CourseRow {
  CourseRow({
    required this.courseName,
    required this.className,
    required this.status,
    required this.paymentStatus,
  });

  final String courseName;
  final String? className;
  final String status;
  final String paymentStatus;

  factory CourseRow.fromJson(Map<String, dynamic> j) => CourseRow(
        courseName: (j['courseName'] as String?) ?? '',
        className: j['className'] as String?,
        status: (j['status'] as String?) ?? '',
        paymentStatus: (j['paymentStatus'] as String?) ?? '',
      );
}

class AttendanceSummary {
  AttendanceSummary({
    required this.totalSessions,
    required this.presentCount,
    required this.absentCount,
    required this.attendanceRate,
    required this.byClass,
    required this.recent,
  });

  final int totalSessions;
  final int presentCount;
  final int absentCount;
  final double attendanceRate;
  final List<ClassAttendance> byClass;
  final List<AttendanceRow> recent;

  factory AttendanceSummary.fromJson(Map<String, dynamic> j) => AttendanceSummary(
        totalSessions: _num(j['totalSessions']).round(),
        presentCount: _num(j['presentCount']).round(),
        absentCount: _num(j['absentCount']).round(),
        attendanceRate: _num(j['attendanceRate']),
        byClass: _list(j['byClass']).map(ClassAttendance.fromJson).toList(),
        recent: _list(j['recent']).map(AttendanceRow.fromJson).toList(),
      );
}

class ClassAttendance {
  ClassAttendance({
    required this.className,
    required this.totalSessions,
    required this.presentCount,
    required this.attendanceRate,
  });

  final String className;
  final int totalSessions;
  final int presentCount;
  final double attendanceRate;

  factory ClassAttendance.fromJson(Map<String, dynamic> j) => ClassAttendance(
        className: (j['className'] as String?) ?? '',
        totalSessions: _num(j['totalSessions']).round(),
        presentCount: _num(j['presentCount']).round(),
        attendanceRate: _num(j['attendanceRate']),
      );
}

class AttendanceRow {
  AttendanceRow({
    required this.date,
    required this.className,
    required this.isPresent,
    required this.status,
    required this.substitutedSessionDate,
  });

  final String date;
  final String className;
  final bool isPresent;

  /// PRESENT | ABSENT | SUBSTITUTED — SUBSTITUTED means the missed session was
  /// made up in another group, which a parent reads very differently from a
  /// plain absence.
  final String status;
  final String? substitutedSessionDate;

  factory AttendanceRow.fromJson(Map<String, dynamic> j) => AttendanceRow(
        date: (j['sessionStartDate'] as String?) ?? '',
        className: (j['className'] as String?) ?? '',
        isPresent: j['isPresent'] == true,
        status: (j['status'] as String?) ?? (j['isPresent'] == true ? 'PRESENT' : 'ABSENT'),
        substitutedSessionDate: j['substitutedSessionDate'] as String?,
      );
}

class ExamRow {
  ExamRow({
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
  final String examDate;
  final String grade;
  final double? maxGrade;
  final bool isHomework;

  /// A rating scale mark (ممتاز…ضعيف) rather than a number over a total.
  final bool isRating;
  final bool isAbsent;
  final bool notMarked;

  factory ExamRow.fromJson(Map<String, dynamic> j) => ExamRow(
        examName: (j['examName'] as String?) ?? '',
        courseName: (j['courseName'] as String?) ?? '',
        examDate: (j['examDate'] as String?) ?? '',
        grade: (j['grade'] as String?) ?? '',
        maxGrade: j['maxGrade'] is num ? (j['maxGrade'] as num).toDouble() : null,
        isHomework: j['isHomework'] == true,
        isRating: j['isRating'] == true,
        isAbsent: j['isAbsent'] == true,
        notMarked: j['notMarked'] == true,
      );
}

/// One row on the "money" list, flattened from the API's four billing shapes
/// so the UI can render a single legible list of what is owed and what closed.
class PaymentRow {
  PaymentRow({
    required this.title,
    required this.subtitle,
    required this.amountDue,
    required this.amountPaid,
    required this.status,
  });

  final String title;
  final String subtitle;
  final double amountDue;
  final double amountPaid;
  final String status;

  double get remaining => amountDue - amountPaid;
}

class PaymentsSummary {
  PaymentsSummary({required this.rows, required this.totalOutstanding});

  final List<PaymentRow> rows;
  final double totalOutstanding;

  factory PaymentsSummary.fromJson(Map<String, dynamic> j) {
    final rows = <PaymentRow>[];

    for (final m in _list(j['monthly'])) {
      rows.add(PaymentRow(
        title: (m['courseName'] as String?) ?? '',
        subtitle: 'شهر ${m['billingMonth']}/${m['billingYear']}',
        amountDue: _num(m['amountDue']),
        amountPaid: _num(m['amountPaid']),
        status: (m['status'] as String?) ?? '',
      ));
    }
    for (final s in _list(j['sessions'])) {
      final n = s['sessionNumber'];
      rows.add(PaymentRow(
        title: (s['courseName'] as String?) ?? '',
        subtitle: n == null ? 'حصة' : 'حصة رقم $n',
        amountDue: _num(s['amountDue']),
        amountPaid: _num(s['amountPaid']),
        status: (s['status'] as String?) ?? '',
      ));
    }
    for (final p in _list(j['packages'])) {
      rows.add(PaymentRow(
        title: (p['courseName'] as String?) ?? '',
        subtitle: 'باقة ${p['sessionsUsed']}/${p['sessionsTotal']} حصة',
        amountDue: _num(p['amountDue']),
        amountPaid: _num(p['amountPaid']),
        status: (p['status'] as String?) ?? '',
      ));
    }
    for (final o in _list(j['oneTime'])) {
      rows.add(PaymentRow(
        title: (o['courseName'] as String?) ?? '',
        subtitle: 'اشتراك الكورس',
        amountDue: _num(o['finalPrice']),
        amountPaid: _num(o['amountPaid']),
        status: (o['status'] as String?) ?? '',
      ));
    }

    return PaymentsSummary(
      rows: rows,
      totalOutstanding: _num(j['totalOutstanding']),
    );
  }
}
