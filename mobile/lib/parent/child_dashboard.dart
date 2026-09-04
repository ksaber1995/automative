import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../models/parent_profile.dart';
import 'children_store.dart';
import 'widgets/attendance_ring.dart';

/// Everything a parent can know about one child, on one scrolling page:
/// attendance front and centre, then money, groups, recent sessions and marks.
/// Same data as the web card page — organised around the questions a parent
/// actually opens the app to answer ("هل حضر؟ هل عليّ فلوس؟ جاب كام؟").
class ChildDashboard extends StatefulWidget {
  const ChildDashboard({super.key, required this.token, this.initial});

  final String token;

  /// The profile fetched during add, so the first paint costs nothing.
  final ParentProfile? initial;

  @override
  State<ChildDashboard> createState() => _ChildDashboardState();
}

class _ChildDashboardState extends State<ChildDashboard> {
  ParentProfile? _profile;
  String? _error;

  @override
  void initState() {
    super.initState();
    _profile = widget.initial;
    if (_profile == null) _load();
  }

  Future<void> _load() async {
    try {
      final p = await context.read<ChildrenStore>().fetchProfile(widget.token);
      if (mounted) setState(() => _profile = p);
    } catch (e) {
      if (mounted) setState(() => _error = 'تعذر تحميل البيانات — اسحب للتحديث.');
    }
  }

  String _day(String iso) {
    final d = DateTime.tryParse(iso);
    return d == null ? iso : intl.DateFormat('d/M/yyyy').format(d);
  }

  @override
  Widget build(BuildContext context) {
    final p = _profile;
    if (p == null) {
      return Scaffold(
        appBar: AppBar(
            backgroundColor: AppTheme.indigo,
            title: const Text('جاري التحميل…')),
        body: Center(
          child: _error == null
              ? const CircularProgressIndicator()
              : Text(_error!, style: const TextStyle(color: AppTheme.red)),
        ),
      );
    }

    final outstanding = p.payments?.totalOutstanding ?? 0;

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(child: _Header(profile: p)),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              sliver: SliverList(
                delegate: SliverChildListDelegate([
                  if (outstanding > 0) _OutstandingBanner(amount: outstanding),
                  if (p.attendance.byClass.isNotEmpty) ...[
                    const SectionTitle('الحضور حسب المجموعة',
                        icon: Icons.groups_outlined),
                    ...p.attendance.byClass.map((c) => _ByClassRow(row: c)),
                  ],
                  if (p.attendance.recent.isNotEmpty) ...[
                    const SectionTitle('آخر الحصص', icon: Icons.history),
                    Card(
                      child: Column(
                        children: [
                          for (final r in p.attendance.recent.take(10))
                            _SessionTile(row: r, day: _day),
                        ],
                      ),
                    ),
                  ],
                  if (p.courses.isNotEmpty) ...[
                    const SectionTitle('الكورسات', icon: Icons.menu_book_outlined),
                    ...p.courses.map((c) => _CourseCard(row: c)),
                  ],
                  if (p.exams.isNotEmpty) ...[
                    const SectionTitle('النتائج والواجبات',
                        icon: Icons.emoji_events_outlined),
                    Card(
                      child: Column(
                        children: [
                          for (final e in p.exams.take(15))
                            _ExamTile(row: e, day: _day),
                        ],
                      ),
                    ),
                  ],
                  if ((p.payments?.rows.isNotEmpty ?? false)) ...[
                    const SectionTitle('المدفوعات', icon: Icons.payments_outlined),
                    Card(
                      child: Column(
                        children: [
                          for (final r in p.payments!.rows.take(20))
                            _PaymentTile(row: r),
                        ],
                      ),
                    ),
                  ],
                ]),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.profile});

  final ParentProfile profile;

  @override
  Widget build(BuildContext context) {
    final a = profile.attendance;
    return Container(
      decoration: const BoxDecoration(
        gradient: AppTheme.headerGradient,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
      ),
      padding: EdgeInsets.only(
          top: MediaQuery.of(context).padding.top + 8, bottom: 24),
      child: Column(
        children: [
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.arrow_back, color: Colors.white),
                onPressed: () => Navigator.of(context).maybePop(),
              ),
              Expanded(
                child: Column(
                  children: [
                    Text(profile.studentName,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            color: Colors.white, fontWeight: FontWeight.w800)),
                    Text(
                      [profile.academyName, profile.branchName]
                          .where((s) => s.isNotEmpty)
                          .join(' · '),
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: Colors.white70),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 48), // mirror the back button
            ],
          ),
          const SizedBox(height: 12),
          AttendanceRing(rate: a.attendanceRate),
          const SizedBox(height: 16),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Expanded(
                    child: _HeaderStat(
                        value: '${a.presentCount}', label: 'حضور')),
                Expanded(
                    child:
                        _HeaderStat(value: '${a.absentCount}', label: 'غياب')),
                Expanded(
                    child: _HeaderStat(
                        value: '${a.totalSessions}', label: 'إجمالي الحصص')),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeaderStat extends StatelessWidget {
  const _HeaderStat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(value,
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(color: Colors.white, fontWeight: FontWeight.w800)),
        Text(label,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: Colors.white70)),
      ],
    );
  }
}

class _OutstandingBanner extends StatelessWidget {
  const _OutstandingBanner({required this.amount});

  final double amount;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.amber.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.amber.withValues(alpha: 0.5)),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline, color: Color(0xFFB45309)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'مبالغ مستحقة: ${amount.toStringAsFixed(amount.truncateToDouble() == amount ? 0 : 2)}',
              style: const TextStyle(
                  color: Color(0xFF92400E), fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}

class _ByClassRow extends StatelessWidget {
  const _ByClassRow({required this.row});

  final ClassAttendance row;

  @override
  Widget build(BuildContext context) {
    final rate = row.attendanceRate.clamp(0, 100).toDouble();
    final color = rate >= 80
        ? AppTheme.green
        : rate >= 60
            ? AppTheme.amber
            : AppTheme.red;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(row.className,
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
                Text('${rate.round()}٪ · ${row.presentCount}/${row.totalSessions}',
                    style: TextStyle(color: color, fontWeight: FontWeight.w800)),
              ],
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: rate / 100,
                minHeight: 8,
                backgroundColor: const Color(0xFFEDEDF7),
                valueColor: AlwaysStoppedAnimation(color),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({required this.row, required this.day});

  final AttendanceRow row;
  final String Function(String) day;

  @override
  Widget build(BuildContext context) {
    final (icon, color, label) = switch (row.status) {
      'PRESENT' => (Icons.check_circle, AppTheme.green, 'حضر'),
      'SUBSTITUTED' => (Icons.swap_horiz, AppTheme.amber, 'حصة بديلة'),
      _ => (Icons.cancel, AppTheme.red, 'غاب'),
    };
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text(row.className,
          style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(day(row.date)),
      trailing: Text(label,
          style: TextStyle(color: color, fontWeight: FontWeight.w800)),
    );
  }
}

class _CourseCard extends StatelessWidget {
  const _CourseCard({required this.row});

  final CourseRow row;

  @override
  Widget build(BuildContext context) {
    final active = row.status != 'DROPPED';
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: AppTheme.indigo.withValues(alpha: 0.09),
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Icon(Icons.school_outlined, color: AppTheme.indigo),
        ),
        title: Text(row.courseName,
            style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: row.className == null ? null : Text(row.className!),
        trailing: Text(
          active ? 'مستمر' : 'انسحب',
          style: TextStyle(
              color: active ? AppTheme.green : Colors.grey,
              fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

class _ExamTile extends StatelessWidget {
  const _ExamTile({required this.row, required this.day});

  final ExamRow row;
  final String Function(String) day;

  @override
  Widget build(BuildContext context) {
    final String mark;
    final Color color;
    if (row.isAbsent) {
      mark = 'غائب';
      color = AppTheme.red;
    } else if (row.notMarked) {
      mark = 'لم يُصحح';
      color = Colors.grey;
    } else if (row.isRating || row.maxGrade == null) {
      mark = row.grade;
      color = AppTheme.indigo;
    } else {
      mark = '${row.grade}/${_trim(row.maxGrade!)}';
      color = AppTheme.indigo;
    }
    return ListTile(
      leading: Icon(
        row.isHomework ? Icons.edit_note : Icons.emoji_events_outlined,
        color: AppTheme.violet,
      ),
      title:
          Text(row.examName, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text('${row.courseName} · ${day(row.examDate)}'),
      trailing:
          Text(mark, style: TextStyle(color: color, fontWeight: FontWeight.w800)),
    );
  }

  String _trim(double v) =>
      v.truncateToDouble() == v ? v.toInt().toString() : v.toString();
}

class _PaymentTile extends StatelessWidget {
  const _PaymentTile({required this.row});

  final PaymentRow row;

  @override
  Widget build(BuildContext context) {
    final settled = row.remaining <= 0;
    return ListTile(
      leading: Icon(
        settled ? Icons.check_circle_outline : Icons.hourglass_bottom,
        color: settled ? AppTheme.green : AppTheme.amber,
      ),
      title:
          Text(row.title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(row.subtitle),
      trailing: Text(
        settled ? 'مدفوع' : 'متبقي ${row.remaining.toStringAsFixed(0)}',
        style: TextStyle(
            color: settled ? AppTheme.green : const Color(0xFFB45309),
            fontWeight: FontWeight.w800),
      ),
    );
  }
}
