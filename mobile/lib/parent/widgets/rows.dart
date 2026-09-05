import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;

import '../../core/theme.dart';
import '../../models/parent_profile.dart';

/// The list rows of a child's record — one session, one mark, one bill, one
/// group's rate — shared by the dashboard and the three detail screens so a
/// present tick, an overdue amount or a homework mark look the same wherever
/// a parent meets them.
String fmtDay(String iso) {
  final d = DateTime.tryParse(iso);
  return d == null ? iso : intl.DateFormat('d/M/yyyy').format(d);
}

/// Money without a trailing ".00", with one to two decimals when they matter.
String fmtAmount(double v) =>
    v.truncateToDouble() == v ? v.toInt().toString() : v.toStringAsFixed(2);

String _trim(double v) =>
    v.truncateToDouble() == v ? v.toInt().toString() : v.toString();

/// The web's attendance-rate colouring: green from 80٪, amber from 60٪.
Color rateColor(double rate) => rate >= 80
    ? AppTheme.green
    : rate >= 60
        ? AppTheme.amber
        : AppTheme.red;

/// One group's attendance rate with a bar.
class ByClassRow extends StatelessWidget {
  const ByClassRow({super.key, required this.row});

  final ClassAttendance row;

  @override
  Widget build(BuildContext context) {
    final rate = row.attendanceRate.clamp(0, 100).toDouble();
    final color = rateColor(rate);
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
                backgroundColor: AppTheme.line,
                valueColor: AlwaysStoppedAnimation(color),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One session: present, absent, or made up in another group.
class SessionTile extends StatelessWidget {
  const SessionTile({super.key, required this.row});

  final AttendanceRow row;

  @override
  Widget build(BuildContext context) {
    final (icon, color, label) = switch (row.status) {
      'PRESENT' => (Icons.check_circle, AppTheme.green, 'حضر'),
      'SUBSTITUTED' => (Icons.swap_horiz, AppTheme.amber, 'حصة بديلة'),
      _ => (Icons.cancel, AppTheme.red, 'غاب'),
    };
    final sub = row.substitutedSessionDate;
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text(row.className,
          style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(
        row.status == 'SUBSTITUTED' && sub != null && sub.isNotEmpty
            ? '${fmtDay(row.date)} · بديلة عن ${fmtDay(sub)}'
            : fmtDay(row.date),
      ),
      trailing: Text(label,
          style: TextStyle(color: color, fontWeight: FontWeight.w800)),
    );
  }
}

/// One exam or homework mark.
class ExamTile extends StatelessWidget {
  const ExamTile({super.key, required this.row});

  final ExamRow row;

  @override
  Widget build(BuildContext context) {
    final String mark;
    final Color color;
    if (row.isAbsent) {
      mark = 'غائب';
      color = AppTheme.red;
    } else if (row.notMarked) {
      mark = 'لم يُصحح';
      color = AppTheme.muted;
    } else if (row.isRating || row.maxGrade == null) {
      mark = row.grade;
      color = AppTheme.exam;
    } else {
      mark = '${row.grade}/${_trim(row.maxGrade!)}';
      color = AppTheme.exam;
    }
    return ListTile(
      leading: Icon(
        row.isHomework ? Icons.edit_note : Icons.emoji_events_outlined,
        color: AppTheme.exam,
      ),
      title:
          Text(row.examName, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text([
        row.courseName,
        if (row.examDate.isNotEmpty) fmtDay(row.examDate),
      ].join(' · ')),
      trailing:
          Text(mark, style: TextStyle(color: color, fontWeight: FontWeight.w800)),
    );
  }
}

/// One bill: settled, or with what is still owed.
class PaymentTile extends StatelessWidget {
  const PaymentTile({super.key, required this.row});

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
      subtitle: Text(settled
          ? '${row.subtitle} · ${fmtAmount(row.amountDue)}'
          : '${row.subtitle} · مدفوع ${fmtAmount(row.amountPaid)} من ${fmtAmount(row.amountDue)}'),
      trailing: Text(
        settled ? 'مدفوع' : 'متبقي ${fmtAmount(row.remaining)}',
        style: TextStyle(
            color: settled ? AppTheme.green : AppTheme.amberDeep,
            fontWeight: FontWeight.w800),
      ),
    );
  }
}

/// The "nothing here" body every detail screen shares.
class EmptyNote extends StatelessWidget {
  const EmptyNote({super.key, required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 64),
      child: Column(
        children: [
          Icon(icon, size: 56, color: AppTheme.lineStrong),
          const SizedBox(height: 12),
          Text(text,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppTheme.muted)),
        ],
      ),
    );
  }
}

/// A row of pill filters — "الكل / حضور / غياب". Single-select.
class FilterPills<T> extends StatelessWidget {
  const FilterPills({
    super.key,
    required this.options,
    required this.value,
    required this.onChanged,
  });

  final List<(T, String)> options;
  final T value;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final (v, label) in options) ...[
            ChoiceChip(
              label: Text(label),
              selected: v == value,
              onSelected: (_) => onChanged(v),
              showCheckmark: false,
              selectedColor: AppTheme.primary,
              backgroundColor: AppTheme.card,
              side: BorderSide(
                  color: v == value ? AppTheme.primary : AppTheme.lineStrong),
              labelStyle: TextStyle(
                fontWeight: FontWeight.w700,
                color: v == value ? Colors.white : AppTheme.ink,
              ),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(999)),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }
}
