import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/theme.dart';
import 'parent/parent_home.dart';
import 'student/student_home.dart';
import 'student/student_login.dart';
import 'student/student_session.dart';

/// The front door: one app, two audiences. A parent follows their children; a
/// student sits exams. Neither mode locks the other out — the same phone in a
/// household can serve both.
class LandingScreen extends StatelessWidget {
  const LandingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<StudentSession>();

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppTheme.headerGradient),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              children: [
                const Spacer(),
                Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.14),
                    shape: BoxShape.circle,
                  ),
                  child:
                      const Icon(Icons.auto_awesome, size: 56, color: Colors.white),
                ),
                const SizedBox(height: 20),
                Text('نتروفت',
                    style: Theme.of(context).textTheme.displaySmall?.copyWith(
                        color: Colors.white, fontWeight: FontWeight.w800)),
                Text('تابع أبناءك — وحِل امتحاناتك',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(color: Colors.white70)),
                const Spacer(),
                _ModeCard(
                  icon: Icons.family_restroom,
                  title: 'أنا ولي أمر',
                  subtitle: 'امسح بطاقة ابنك وتابع الحضور والدرجات والمدفوعات',
                  onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const ParentHome())),
                ),
                const SizedBox(height: 14),
                _ModeCard(
                  icon: Icons.school,
                  title: 'أنا طالب',
                  subtitle: session.signedIn
                      ? 'مرحبًا ${session.student?.name ?? ''} — امتحاناتك بانتظارك'
                      : 'سجّل دخولك وحِل امتحاناتك من الموبايل',
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => session.signedIn
                        ? const StudentHome()
                        : const StudentLoginScreen(),
                  )),
                ),
                const SizedBox(height: 40),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ModeCard extends StatelessWidget {
  const _ModeCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  gradient: AppTheme.headerGradient,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(icon, color: Colors.white, size: 28),
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
                    Text(subtitle,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: Colors.grey[600])),
                  ],
                ),
              ),
              const Icon(Icons.chevron_left, color: AppTheme.indigo),
            ],
          ),
        ),
      ),
    );
  }
}
