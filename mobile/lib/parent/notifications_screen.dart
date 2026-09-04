import 'package:flutter/material.dart';
import 'package:intl/intl.dart' as intl;
import 'package:provider/provider.dart';

import '../core/theme.dart';
import 'notifications.dart';

/// The notification centre: every recorded event across the saved children,
/// newest first, with the unread ones marked until this screen is opened.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  DateTime? _seenAtOpen;

  @override
  void initState() {
    super.initState();
    final ctrl = context.read<NotificationsController>();
    _seenAtOpen = ctrl.lastSeen;
    ctrl.refresh().then((_) => ctrl.markSeen());
  }

  @override
  Widget build(BuildContext context) {
    final ctrl = context.watch<NotificationsController>();
    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppTheme.indigo,
        title: const Text('التنبيهات', style: TextStyle(fontWeight: FontWeight.w800)),
      ),
      body: RefreshIndicator(
        onRefresh: () => ctrl.refresh(),
        child: ctrl.loading && ctrl.items.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : ctrl.items.isEmpty
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      const SizedBox(height: 120),
                      const Icon(Icons.notifications_none,
                          size: 64, color: Color(0xFFC9C9E2)),
                      const SizedBox(height: 12),
                      Center(
                        child: Text('لا توجد تنبيهات بعد',
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w800)),
                      ),
                      Center(
                        child: Text(
                            'حضور وغياب ومدفوعات ونتائج أبنائك ستصل هنا.',
                            style: TextStyle(color: Colors.grey[600])),
                      ),
                    ],
                  )
                : ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    itemCount: ctrl.items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (context, i) => _NotificationCard(
                      item: ctrl.items[i],
                      isNew: _seenAtOpen != null &&
                          ctrl.items[i].createdAt.isAfter(_seenAtOpen!),
                    ),
                  ),
      ),
    );
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({required this.item, required this.isNew});

  final ParentNotification item;
  final bool isNew;

  IconData get _icon {
    final t = item.title;
    if (t.contains('حضور')) return Icons.check_circle_outline;
    if (t.contains('غياب') || t.contains('❌')) return Icons.cancel_outlined;
    if (t.contains('دفعة') || t.contains('💰')) return Icons.payments_outlined;
    if (t.contains('واجب')) return Icons.edit_note;
    if (t.contains('امتحان') || t.contains('نتيجة')) {
      return Icons.emoji_events_outlined;
    }
    return Icons.notifications_none;
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: isNew
            ? const BorderSide(color: AppTheme.indigo, width: 1.4)
            : BorderSide.none,
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppTheme.indigo.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(_icon, color: AppTheme.indigo),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(item.title,
                            style: const TextStyle(fontWeight: FontWeight.w800)),
                      ),
                      if (isNew)
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppTheme.indigo,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: const Text('جديد',
                              style: TextStyle(
                                  color: Colors.white, fontSize: 11)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(item.body, style: const TextStyle(height: 1.5)),
                  const SizedBox(height: 6),
                  Text(
                    '${item.childName} · ${intl.DateFormat('d/M/yyyy – h:mm a').format(item.createdAt)}',
                    style: TextStyle(color: Colors.grey[500], fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
