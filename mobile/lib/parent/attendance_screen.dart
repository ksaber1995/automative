import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/parent_profile.dart';
import 'widgets/attendance_ring.dart';
import 'widgets/rows.dart';

enum _Filter { all, present, absent, substituted }

/// Attendance and absence for one child, on its own page: the overall rate,
/// the rate per group, and every recorded session — filterable so a parent
/// who only wants "when did he miss?" gets that list and nothing else.
class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key, required this.profile});

  final ParentProfile profile;

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  _Filter _filter = _Filter.all;

  @override
  Widget build(BuildContext context) {
    final a = widget.profile.attendance;
    final rows = a.recent.where((r) => switch (_filter) {
          _Filter.all => true,
          _Filter.present => r.status == 'PRESENT',
          _Filter.absent => r.status == 'ABSENT',
          _Filter.substituted => r.status == 'SUBSTITUTED',
        }).toList();
    final substituted =
        a.recent.where((r) => r.status == 'SUBSTITUTED').length;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          children: [
            const Text('الحضور والغياب'),
            Text(widget.profile.studentName,
                style: const TextStyle(fontSize: 12, color: Color(0xFFB3B3B3))),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          // Rate + the three counts, on the chrome so the ring reads the same
          // as on the dashboard.
          Container(
            margin: const EdgeInsets.only(bottom: 4),
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 20),
            decoration: BoxDecoration(
              gradient: AppTheme.headerGradient,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                AttendanceRing(rate: a.attendanceRate, size: 116),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _Count(
                          icon: Icons.check_circle,
                          color: AppTheme.accent,
                          label: 'حضور',
                          value: a.presentCount),
                      const SizedBox(height: 8),
                      _Count(
                          icon: Icons.cancel,
                          color: const Color(0xFFF87171),
                          label: 'غياب',
                          value: a.absentCount),
                      const SizedBox(height: 8),
                      _Count(
                          icon: Icons.event_note,
                          color: const Color(0xFFB3B3B3),
                          label: 'إجمالي الحصص',
                          value: a.totalSessions),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (a.byClass.isNotEmpty) ...[
            const SectionTitle('حسب المجموعة', icon: Icons.groups_outlined),
            ...a.byClass.map((c) => ByClassRow(row: c)),
          ],
          const SectionTitle('سجل الحصص', icon: Icons.history),
          FilterPills<_Filter>(
            value: _filter,
            onChanged: (v) => setState(() => _filter = v),
            options: [
              (_Filter.all, 'الكل (${a.recent.length})'),
              (_Filter.present, 'حضور (${a.presentCount})'),
              (_Filter.absent, 'غياب (${a.absentCount})'),
              if (substituted > 0) (_Filter.substituted, 'بديلة ($substituted)'),
            ],
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            const EmptyNote(
                icon: Icons.event_available_outlined,
                text: 'لا توجد حصص مطابقة')
          else
            Card(
              child: Column(
                children: [
                  for (var i = 0; i < rows.length; i++) ...[
                    if (i > 0) const Divider(height: 1, indent: 56),
                    SessionTile(row: rows[i]),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _Count extends StatelessWidget {
  const _Count({
    required this.icon,
    required this.color,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final Color color;
  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(label,
              style: const TextStyle(color: Color(0xFFB3B3B3), fontSize: 13)),
        ),
        Text('$value',
            style: const TextStyle(
                color: Colors.white, fontWeight: FontWeight.w800, fontSize: 18)),
      ],
    );
  }
}
