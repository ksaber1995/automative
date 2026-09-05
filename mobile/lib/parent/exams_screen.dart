import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/parent_profile.dart';
import 'widgets/rows.dart';

enum _Filter { all, exams, homework }

/// Every exam and homework mark for one child, on its own page. Exams and
/// homework are the same rows to the API; here they split into two pills so a
/// parent asking "did she do her homework?" is not scanning exam scores.
class ExamsScreen extends StatefulWidget {
  const ExamsScreen({super.key, required this.profile});

  final ParentProfile profile;

  @override
  State<ExamsScreen> createState() => _ExamsScreenState();
}

class _ExamsScreenState extends State<ExamsScreen> {
  _Filter _filter = _Filter.all;

  @override
  Widget build(BuildContext context) {
    final all = widget.profile.exams;
    final exams = all.where((e) => !e.isHomework).toList();
    final homework = all.where((e) => e.isHomework).toList();
    final absent = all.where((e) => e.isAbsent).length;
    final pending = all.where((e) => e.notMarked && !e.isAbsent).length;

    final rows = switch (_filter) {
      _Filter.all => all,
      _Filter.exams => exams,
      _Filter.homework => homework,
    };

    return Scaffold(
      appBar: AppBar(
        title: Column(
          children: [
            const Text('الامتحانات والواجبات'),
            Text(widget.profile.studentName,
                style: const TextStyle(fontSize: 12, color: Color(0xFFB3B3B3))),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Row(
            children: [
              Expanded(
                child: StatChip(
                    label: 'امتحان',
                    value: '${exams.length}',
                    color: AppTheme.exam),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: StatChip(
                    label: 'واجب',
                    value: '${homework.length}',
                    color: AppTheme.info),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: StatChip(
                  label: absent > 0 ? 'لم يقدّم' : 'لم يُصحح',
                  value: '${absent > 0 ? absent : pending}',
                  color: absent > 0 ? AppTheme.red : AppTheme.muted,
                ),
              ),
            ],
          ),
          const SectionTitle('النتائج', icon: Icons.emoji_events_outlined),
          FilterPills<_Filter>(
            value: _filter,
            onChanged: (v) => setState(() => _filter = v),
            options: [
              (_Filter.all, 'الكل (${all.length})'),
              (_Filter.exams, 'امتحانات (${exams.length})'),
              (_Filter.homework, 'واجبات (${homework.length})'),
            ],
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            EmptyNote(
              icon: Icons.assignment_outlined,
              text: switch (_filter) {
                _Filter.homework => 'لا توجد واجبات مسجّلة بعد',
                _Filter.exams => 'لا توجد امتحانات مسجّلة بعد',
                _Filter.all => 'لا توجد نتائج بعد',
              },
            )
          else
            Card(
              child: Column(
                children: [
                  for (var i = 0; i < rows.length; i++) ...[
                    if (i > 0) const Divider(height: 1, indent: 56),
                    ExamTile(row: rows[i]),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}
