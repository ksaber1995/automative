import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../core/theme.dart';
import '../models/parent_profile.dart';
import 'widgets/rows.dart';

enum _Filter { all, praise, concern }

/// What the teachers wrote about this child — comments, praise, concerns —
/// exactly as they wrote them, newest first. The academy chooses which notes
/// the family sees; everything here was chosen.
class FollowUpScreen extends StatefulWidget {
  const FollowUpScreen({super.key, required this.profile});

  final ParentProfile profile;

  @override
  State<FollowUpScreen> createState() => _FollowUpScreenState();
}

class _FollowUpScreenState extends State<FollowUpScreen> {
  _Filter _filter = _Filter.all;

  @override
  Widget build(BuildContext context) {
    final all = widget.profile.notes;
    final praise = all.where((n) => n.kind == 'PRAISE').length;
    final concern = all.where((n) => n.kind == 'CONCERN').length;
    final rows = all.where((n) => switch (_filter) {
          _Filter.all => true,
          _Filter.praise => n.kind == 'PRAISE',
          _Filter.concern => n.kind == 'CONCERN',
        }).toList();

    return Scaffold(
      appBar: AppBar(
        title: Column(
          children: [
            const Text('متابعة المدرّس'),
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
                    label: 'ملاحظة', value: '${all.length}', color: AppTheme.exam),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: StatChip(
                    label: 'إشادة', value: '$praise', color: AppTheme.green),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: StatChip(
                    label: 'تنبيه', value: '$concern', color: AppTheme.amber),
              ),
            ],
          ),
          const SectionTitle('ملاحظات المدرّسين', icon: Icons.forum_outlined),
          FilterPills<_Filter>(
            value: _filter,
            onChanged: (v) => setState(() => _filter = v),
            options: [
              (_Filter.all, 'الكل (${all.length})'),
              (_Filter.praise, 'إشادات ($praise)'),
              (_Filter.concern, 'تنبيهات ($concern)'),
            ],
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            EmptyNote(
              icon: Icons.forum_outlined,
              text: switch (_filter) {
                _Filter.praise => 'لا توجد إشادات بعد',
                _Filter.concern => 'لا توجد تنبيهات — خبر جيد 👍',
                _Filter.all => 'لم يكتب المدرّسون ملاحظات بعد',
              },
            )
          else
            ...rows.map((n) => _NoteCard(note: n)),
        ],
      ),
    );
  }
}

/// One note: who wrote it, when, what kind, and the words themselves.
class _NoteCard extends StatelessWidget {
  const _NoteCard({required this.note});

  final NoteRow note;

  @override
  Widget build(BuildContext context) {
    final (icon, color, label) = switch (note.kind) {
      'PRAISE' => (Icons.star_rounded, AppTheme.green, 'إشادة'),
      'CONCERN' => (Icons.warning_amber_rounded, AppTheme.amberDeep, 'تنبيه'),
      _ => (Icons.chat_bubble_outline, AppTheme.exam, 'ملاحظة'),
    };
    final when = DateTime.tryParse(note.createdAt)?.toLocal();
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  alignment: Alignment.center,
                  child: Icon(icon, color: color, size: 20),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        note.authorName.isEmpty ? 'فريق الأكاديمية' : note.authorName,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      if (when != null)
                        Text(
                          intl.DateFormat('d/M/yyyy · h:mm a').format(when),
                          style: const TextStyle(
                              color: AppTheme.muted, fontSize: 12),
                        ),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(label,
                      style: TextStyle(
                          color: color,
                          fontSize: 12,
                          fontWeight: FontWeight.w700)),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(note.body, style: const TextStyle(height: 1.6)),
          ],
        ),
      ),
    );
  }
}
