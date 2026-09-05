import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/theme.dart';
import '../models/student_models.dart';
import 'exam_sit_screen.dart';
import 'student_card_tab.dart';
import 'student_session.dart';

/// The signed-in student's home: available exams first (that is what they came
/// for), all past results behind the second tab, and the student's own card —
/// QR plus short code — behind the third.
class StudentHome extends StatefulWidget {
  const StudentHome({super.key});

  @override
  State<StudentHome> createState() => _StudentHomeState();
}

class _StudentHomeState extends State<StudentHome> {
  int _tab = 0;

  List<ExamListItem>? _exams;
  List<ResultRow>? _results;
  String? _error;

  StudentExamsApi get _api =>
      StudentExamsApi(context.read<StudentSession>().api);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final exams = await _api.list();
      final results = await _api.results();
      if (!mounted) return;
      setState(() {
        _exams = exams;
        _results = results;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.isUnauthorized) {
        await context.read<StudentSession>().expire();
        if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
        return;
      }
      setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذر التحميل — اسحب للتحديث.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<StudentSession>();
    return Scaffold(
      appBar: AppBar(
        title: Column(
          children: [
            const Text('بوابة الطالب'),
            if (session.student != null)
              Text(session.student!.name,
                  style: const TextStyle(
                      fontSize: 12, color: Color(0xFFB3B3B3))),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'تسجيل الخروج',
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await session.logout();
              if (context.mounted) {
                Navigator.of(context).popUntil((r) => r.isFirst);
              }
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _tab == 2 ? session.refreshMe : _load,
        child: switch (_tab) {
          0 => _examsBody(),
          1 => _resultsBody(),
          _ => const StudentCardTab(),
        },
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.assignment_outlined), label: 'الامتحانات'),
          NavigationDestination(
              icon: Icon(Icons.emoji_events_outlined), label: 'نتائجي'),
          NavigationDestination(icon: Icon(Icons.qr_code_2), label: 'بطاقتي'),
        ],
      ),
    );
  }

  Widget _examsBody() {
    final exams = _exams;
    if (_error != null) return _errorBody();
    if (exams == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (exams.isEmpty) {
      return _emptyBody('لا توجد امتحانات متاحة الآن',
          'عندما يفتح مدرّسك امتحانًا أونلاين سيظهر هنا.');
    }
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [for (final e in exams) _ExamCard(item: e, onChanged: _load)],
    );
  }

  Widget _resultsBody() {
    final results = _results;
    if (_error != null) return _errorBody();
    if (results == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (results.isEmpty) {
      return _emptyBody('لا توجد نتائج بعد', 'نتائج امتحاناتك وواجباتك ستظهر هنا.');
    }
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Column(
            children: [for (final r in results) _ResultTile(row: r)],
          ),
        ),
      ],
    );
  }

  Widget _errorBody() => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 120),
          Center(
              child:
                  Text(_error!, style: const TextStyle(color: AppTheme.red))),
        ],
      );

  Widget _emptyBody(String title, String hint) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 100),
          const Icon(Icons.inbox_outlined, size: 64, color: Color(0xFFC9C9E2)),
          const SizedBox(height: 12),
          Center(
              child: Text(title,
                  style: const TextStyle(fontWeight: FontWeight.w800))),
          Center(child: Text(hint, style: TextStyle(color: AppTheme.muted))),
        ],
      );
}

class _ExamCard extends StatelessWidget {
  const _ExamCard({required this.item, required this.onChanged});

  final ExamListItem item;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final (chipText, chipColor) = switch (item.state) {
      'IN_PROGRESS' => ('مستمر — أكمل الحل', AppTheme.amber),
      'DONE' => ('تم التسليم', AppTheme.green),
      _ => ('متاح الآن', AppTheme.primary),
    };

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(item.name,
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w800)),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: chipColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(chipText,
                      style: TextStyle(
                          color: chipColor,
                          fontSize: 12,
                          fontWeight: FontWeight.w700)),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(item.courseName, style: TextStyle(color: AppTheme.muted)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 14,
              runSpacing: 6,
              children: [
                if (item.questionCount != null)
                  _Fact(
                      icon: Icons.help_outline,
                      text: '${item.questionCount} سؤال'),
                if (item.durationMinutes != null)
                  _Fact(
                      icon: Icons.timer_outlined,
                      text: '${item.durationMinutes} دقيقة'),
                if (item.closesAt != null)
                  _Fact(
                      icon: Icons.event_outlined,
                      text: 'يغلق ${_day(item.closesAt!)}'),
                if (item.requiresCode)
                  const _Fact(icon: Icons.key_outlined, text: 'يتطلب كود دخول'),
              ],
            ),
            const SizedBox(height: 14),
            if (item.state == 'DONE')
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.green.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  item.score != null && item.total != null
                      ? 'نتيجتك: ${_trim(item.score!)} / ${_trim(item.total!)}'
                      : 'تم التسليم — النتيجة عند مدرّسك',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      color: AppTheme.green, fontWeight: FontWeight.w800),
                ),
              )
            else
              FilledButton.icon(
                icon: Icon(item.state == 'IN_PROGRESS'
                    ? Icons.play_arrow
                    : Icons.edit_outlined),
                label: Text(
                    item.state == 'IN_PROGRESS' ? 'أكمل الامتحان' : 'ابدأ الامتحان'),
                onPressed: () => _startOrResume(context),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _startOrResume(BuildContext context) async {
    String? accessCode;
    if (item.requiresCode && item.state != 'IN_PROGRESS') {
      accessCode = await _askCode(context);
      if (accessCode == null) return;
    }
    if (!context.mounted) return;
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => ExamSitScreen(
        examId: item.examId,
        resume: item.state == 'IN_PROGRESS',
        accessCode: accessCode,
      ),
    ));
    if (changed == true) onChanged();
  }

  Future<String?> _askCode(BuildContext context) {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('كود الدخول'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          textDirection: TextDirection.ltr,
          decoration: const InputDecoration(hintText: 'اكتب الكود من مدرّسك'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(96, 44)),
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('دخول'),
          ),
        ],
      ),
    );
  }

  String _day(String iso) {
    final d = DateTime.tryParse(iso);
    return d == null ? iso : intl.DateFormat('d/M/yyyy').format(d.toLocal());
  }

  String _trim(double v) =>
      v.truncateToDouble() == v ? v.toInt().toString() : v.toString();
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: AppTheme.muted),
        const SizedBox(width: 4),
        Text(text,
            style: TextStyle(color: AppTheme.muted, fontSize: 13)),
      ],
    );
  }
}

class _ResultTile extends StatelessWidget {
  const _ResultTile({required this.row});

  final ResultRow row;

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
      color = AppTheme.exam;
    } else {
      final max = row.maxGrade!;
      final maxText =
          max.truncateToDouble() == max ? max.toInt().toString() : '$max';
      mark = '${row.grade}/$maxText';
      color = AppTheme.exam;
    }
    return ListTile(
      leading: Icon(
          row.isHomework ? Icons.edit_note : Icons.emoji_events_outlined,
          color: AppTheme.exam),
      title:
          Text(row.examName, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(row.courseName),
      trailing:
          Text(mark, style: TextStyle(color: color, fontWeight: FontWeight.w800)),
    );
  }
}
