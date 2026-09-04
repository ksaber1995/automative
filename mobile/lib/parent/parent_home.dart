import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import 'add_child_screen.dart';
import 'child_dashboard.dart';
import 'children_store.dart';
import 'notifications.dart';
import 'notifications_screen.dart';

/// The parent's front door: the children saved on this phone, one tap from the
/// dashboard. The web page starts from a scan every single time — keeping the
/// family list here is most of why the app beats it.
class ParentHome extends StatelessWidget {
  const ParentHome({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<ChildrenStore>();
    final children = store.children;

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            pinned: true,
            expandedHeight: 150,
            automaticallyImplyLeading: true,
            actions: [
              // The notification centre, with the unread count since the last
              // time it was opened.
              Consumer<NotificationsController>(
                builder: (context, notifs, _) => IconButton(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => const NotificationsScreen())),
                  icon: Badge(
                    isLabelVisible: notifs.unread > 0,
                    label: Text('${notifs.unread}'),
                    child: const Icon(Icons.notifications_none,
                        color: Colors.white),
                  ),
                ),
              ),
            ],
            flexibleSpace: Container(
              decoration: const BoxDecoration(gradient: AppTheme.headerGradient),
              child: const FlexibleSpaceBar(
                title: Text('متابعة الأبناء',
                    style: TextStyle(fontWeight: FontWeight.w800)),
                centerTitle: true,
              ),
            ),
          ),
          if (!store.loaded)
            const SliverFillRemaining(
                child: Center(child: CircularProgressIndicator()))
          else if (children.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(28),
                      decoration: BoxDecoration(
                        color: AppTheme.indigo.withValues(alpha: 0.08),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.qr_code_scanner,
                          size: 64, color: AppTheme.indigo),
                    ),
                    const SizedBox(height: 20),
                    Text('امسح بطاقة ابنك لتتابع كل شيء',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    Text(
                      'الحضور والغياب، الدرجات، والمدفوعات — في مكان واحد، بدون تسجيل دخول.',
                      textAlign: TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(color: Colors.grey[600]),
                    ),
                  ],
                ),
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.all(16),
              sliver: SliverList.separated(
                itemCount: children.length,
                separatorBuilder: (_, _) => const SizedBox(height: 12),
                itemBuilder: (context, i) {
                  final child = children[i];
                  return _ChildCard(
                    name: child.name,
                    academy: child.academy,
                    onOpen: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => ChildDashboard(token: child.token),
                    )),
                    onRemove: () => _confirmRemove(context, child),
                  );
                },
              ),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppTheme.indigo,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.qr_code_scanner),
        label: const Text('إضافة ابن'),
        onPressed: () => Navigator.of(context)
            .push(MaterialPageRoute(builder: (_) => const AddChildScreen())),
      ),
    );
  }

  void _confirmRemove(BuildContext context, SavedChild child) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('إزالة من القائمة؟'),
        content: Text(
            'سيُحذف «${child.name}» من هذا الهاتف فقط — يمكنك إضافته مجددًا بمسح البطاقة.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
          TextButton(
            onPressed: () {
              ctx.read<ChildrenStore>().remove(child.token);
              Navigator.pop(ctx);
            },
            child: const Text('إزالة', style: TextStyle(color: AppTheme.red)),
          ),
        ],
      ),
    );
  }
}

class _ChildCard extends StatelessWidget {
  const _ChildCard({
    required this.name,
    required this.academy,
    required this.onOpen,
    required this.onRemove,
  });

  final String name;
  final String academy;
  final VoidCallback onOpen;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: const BoxDecoration(
                  gradient: AppTheme.headerGradient,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: Text(
                  name.isEmpty ? '؟' : name.characters.first,
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w800),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name,
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    Text(academy,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: Colors.grey[600])),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, color: Colors.grey),
                onPressed: onRemove,
              ),
              const Icon(Icons.chevron_left, color: AppTheme.indigo),
            ],
          ),
        ),
      ),
    );
  }
}
