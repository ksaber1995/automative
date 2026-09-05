import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../models/parent_profile.dart';
import 'attendance_screen.dart';
import 'children_store.dart';
import 'exams_screen.dart';
import 'follow_up_screen.dart';
import 'payments_screen.dart';
import 'widgets/attendance_ring.dart';
import 'widgets/rows.dart';

/// One child's front page. The header answers the first question ("هل حضر؟")
/// at a glance; below it, four doors — attendance, exams & homework,
/// payments, the teacher's follow-up — each carrying a one-line summary, each
/// opening its own page.
/// The groups the child is enrolled in close the page. Nothing scrolls for
/// ever here any more: the long lists live behind the doors.
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

  void _open(Widget Function(ParentProfile) build) {
    final p = _profile;
    if (p == null) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => build(p)));
  }

  @override
  Widget build(BuildContext context) {
    final p = _profile;
    if (p == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('جاري التحميل…')),
        body: Center(
          child: _error == null
              ? const CircularProgressIndicator()
              : Text(_error!, style: const TextStyle(color: AppTheme.red)),
        ),
      );
    }

    final a = p.attendance;
    final exams = p.exams.where((e) => !e.isHomework).length;
    final homework = p.exams.length - exams;
    final outstanding = p.payments?.totalOutstanding ?? 0;
    final dueCount =
        p.payments?.rows.where((r) => r.remaining > 0).length ?? 0;
    final lastSession = a.recent.isEmpty ? null : a.recent.first;
    final concerns = p.notes.where((n) => n.kind == 'CONCERN').length;
    final praise = p.notes.where((n) => n.kind == 'PRAISE').length;
    final lastNote = p.notes.isEmpty ? null : p.notes.first;

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(child: _Header(profile: p)),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              sliver: SliverList(
                delegate: SliverChildListDelegate([
                  if (outstanding > 0) ...[
                    _OutstandingBanner(
                      amount: outstanding,
                      onTap: () => _open((p) => PaymentsScreen(profile: p)),
                    ),
                    const SizedBox(height: 14),
                  ],
                  _HubButton(
                    icon: Icons.fact_check_outlined,
                    color: AppTheme.green,
                    title: 'الحضور والغياب',
                    summary: a.totalSessions == 0
                        ? 'لا توجد حصص مسجّلة بعد'
                        : '${a.attendanceRate.round()}٪ حضور · ${a.absentCount} غياب من ${a.totalSessions} حصة',
                    detail: lastSession == null
                        ? null
                        : 'آخر حصة ${fmtDay(lastSession.date)} — ${switch (lastSession.status) {
                            'PRESENT' => 'حضر',
                            'SUBSTITUTED' => 'حصة بديلة',
                            _ => 'غاب',
                          }}',
                    detailColor: lastSession == null
                        ? null
                        : switch (lastSession.status) {
                            'PRESENT' => AppTheme.green,
                            'SUBSTITUTED' => AppTheme.amberDeep,
                            _ => AppTheme.red,
                          },
                    onTap: () => _open((p) => AttendanceScreen(profile: p)),
                  ),
                  const SizedBox(height: 12),
                  _HubButton(
                    icon: Icons.emoji_events_outlined,
                    color: AppTheme.exam,
                    title: 'الامتحانات والواجبات',
                    summary: p.exams.isEmpty
                        ? 'لا توجد نتائج بعد'
                        : '$exams امتحان · $homework واجب',
                    detail: p.exams.isEmpty ? null : _lastMark(p.exams.first),
                    onTap: () => _open((p) => ExamsScreen(profile: p)),
                  ),
                  const SizedBox(height: 12),
                  _HubButton(
                    icon: Icons.payments_outlined,
                    color: outstanding > 0 ? AppTheme.amber : AppTheme.info,
                    title: 'المدفوعات',
                    summary: p.payments == null || p.payments!.rows.isEmpty
                        ? 'لا توجد فواتير بعد'
                        : outstanding > 0
                            ? 'متبقي ${fmtAmount(outstanding)} على $dueCount ${dueCount == 1 ? 'فاتورة' : 'فواتير'}'
                            : 'كل الفواتير مدفوعة ✓',
                    detail: p.payments == null
                        ? null
                        : '${p.payments!.rows.length} فاتورة',
                    onTap: () => _open((p) => PaymentsScreen(profile: p)),
                  ),
                  const SizedBox(height: 12),
                  _HubButton(
                    icon: Icons.forum_outlined,
                    color: concerns > 0 ? AppTheme.amber : AppTheme.exam,
                    title: 'متابعة المدرّس',
                    summary: p.notes.isEmpty
                        ? 'لم يكتب المدرّسون ملاحظات بعد'
                        : [
                            '${p.notes.length} ملاحظة',
                            if (praise > 0) '$praise إشادة',
                            if (concerns > 0) '$concerns تنبيه',
                          ].join(' · '),
                    detail: lastNote == null
                        ? null
                        : '${lastNote.authorName.isEmpty ? 'المدرّس' : lastNote.authorName}: ${lastNote.body}',
                    detailColor: lastNote?.kind == 'CONCERN'
                        ? AppTheme.amberDeep
                        : lastNote?.kind == 'PRAISE'
                            ? AppTheme.green
                            : null,
                    onTap: () => _open((p) => FollowUpScreen(profile: p)),
                  ),
                  if (p.courses.isNotEmpty) ...[
                    const SectionTitle('الكورسات', icon: Icons.menu_book_outlined),
                    ...p.courses.map((c) => _CourseCard(row: c)),
                  ],
                ]),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _lastMark(ExamRow e) {
    final what = e.isHomework ? 'آخر واجب' : 'آخر امتحان';
    if (e.isAbsent) return '$what: ${e.examName} — غائب';
    if (e.notMarked) return '$what: ${e.examName} — لم يُصحح';
    final max = e.maxGrade;
    final mark = e.isRating || max == null
        ? e.grade
        : '${e.grade}/${max.truncateToDouble() == max ? max.toInt() : max}';
    return '$what: ${e.examName} — $mark';
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
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(24)),
      ),
      padding: EdgeInsets.only(
          top: MediaQuery.of(context).padding.top + 8, bottom: 22),
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
                          ?.copyWith(color: const Color(0xFFB3B3B3)),
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
                ?.copyWith(color: const Color(0xFFB3B3B3))),
      ],
    );
  }
}

/// One of the three doors: an icon on its colour, a title, a one-line summary,
/// and optionally the most recent fact under it.
class _HubButton extends StatelessWidget {
  const _HubButton({
    required this.icon,
    required this.color,
    required this.title,
    required this.summary,
    required this.onTap,
    this.detail,
    this.detailColor,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String summary;
  final String? detail;
  final Color? detailColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14),
                ),
                alignment: Alignment.center,
                child: Icon(icon, color: color, size: 28),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 2),
                    Text(summary,
                        style: const TextStyle(
                            color: AppTheme.ink,
                            fontWeight: FontWeight.w600,
                            fontSize: 13)),
                    if (detail != null) ...[
                      const SizedBox(height: 2),
                      Text(detail!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              color: detailColor ?? AppTheme.muted,
                              fontSize: 12)),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.chevron_left, color: AppTheme.muted),
            ],
          ),
        ),
      ),
    );
  }
}

class _OutstandingBanner extends StatelessWidget {
  const _OutstandingBanner({required this.amount, required this.onTap});

  final double amount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTheme.amber.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppTheme.amber.withValues(alpha: 0.5)),
          ),
          child: Row(
            children: [
              const Icon(Icons.info_outline, color: AppTheme.amberDeep),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'مبالغ مستحقة: ${fmtAmount(amount)}',
                  style: const TextStyle(
                      color: AppTheme.amberDeep, fontWeight: FontWeight.w800),
                ),
              ),
              const Icon(Icons.chevron_left, color: AppTheme.amberDeep),
            ],
          ),
        ),
      ),
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
            color: AppTheme.primary.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Icon(Icons.school_outlined, color: AppTheme.primary),
        ),
        title: Text(row.courseName,
            style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: row.className == null ? null : Text(row.className!),
        trailing: Text(
          active ? 'مستمر' : 'انسحب',
          style: TextStyle(
              color: active ? AppTheme.green : AppTheme.muted,
              fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}
