import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../core/theme.dart';
import 'student_session.dart';

/// The student's card, on the phone: the same QR the printed card carries and
/// the short code a teacher can type when there is no scanner. A forgotten
/// card stops being a reason to miss an attendance mark.
class StudentCardTab extends StatelessWidget {
  const StudentCardTab({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<StudentSession>();
    final s = session.student;
    final payload = s?.qrPayload;
    final code = s?.studentCode;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(20),
      children: [
        // The card: chrome band on top like the web header, white face below.
        Card(
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
                decoration:
                    const BoxDecoration(gradient: AppTheme.headerGradient),
                child: Row(
                  children: [
                    const Icon(Icons.badge_outlined,
                        color: AppTheme.accent, size: 28),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(s?.companyName ?? 'بطاقة الطالب',
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 16)),
                          if ((s?.branchName ?? '').isNotEmpty)
                            Text(s!.branchName!,
                                style: const TextStyle(
                                    color: Color(0xFFB3B3B3), fontSize: 12)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
                child: Column(
                  children: [
                    Text(s?.name ?? '',
                        textAlign: TextAlign.center,
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    if (s != null)
                      Text('@${s.username}',
                          textDirection: TextDirection.ltr,
                          style: const TextStyle(color: AppTheme.muted)),
                    const SizedBox(height: 20),
                    if (payload != null)
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.line),
                        ),
                        child: QrImageView(
                          data: payload,
                          version: QrVersions.auto,
                          size: 220,
                          gapless: true,
                          eyeStyle: const QrEyeStyle(
                              eyeShape: QrEyeShape.square,
                              color: AppTheme.ink),
                          dataModuleStyle: const QrDataModuleStyle(
                              dataModuleShape: QrDataModuleShape.square,
                              color: AppTheme.ink),
                        ),
                      )
                    else
                      _Unavailable(
                        onRetry: session.refreshMe,
                      ),
                    const SizedBox(height: 20),
                    _CodeBox(code: code),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppTheme.info.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.info.withValues(alpha: 0.35)),
          ),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.info_outline, color: AppTheme.info),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'اعرض هذا الـ QR للمدرّس لتسجيل حضورك، أو اقرأ له الكود إن لم يكن معه قارئ. البطاقة على الهاتف تعمل تمامًا مثل البطاقة المطبوعة.',
                  style: TextStyle(color: AppTheme.ink, fontSize: 13),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The short code, big, with one tap to copy it.
class _CodeBox extends StatelessWidget {
  const _CodeBox({required this.code});

  final int? code;

  @override
  Widget build(BuildContext context) {
    final text = code?.toString();
    return Material(
      color: AppTheme.ground,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: text == null
            ? null
            : () async {
                await Clipboard.setData(ClipboardData(text: text));
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('تم نسخ الكود')));
              },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              const Icon(Icons.tag, color: AppTheme.primary),
              const SizedBox(width: 10),
              const Expanded(
                child: Text('كود الطالب',
                    style: TextStyle(
                        color: AppTheme.muted, fontWeight: FontWeight.w600)),
              ),
              Text(
                text ?? '—',
                textDirection: TextDirection.ltr,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      color: AppTheme.ink,
                      letterSpacing: 1.5,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
              ),
              if (text != null) ...[
                const SizedBox(width: 10),
                const Icon(Icons.copy_outlined, size: 18, color: AppTheme.muted),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Shown while /me has not yet answered with a token — an older API build, or
/// a network hiccup on login.
class _Unavailable extends StatelessWidget {
  const _Unavailable({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 244,
      height: 244,
      decoration: BoxDecoration(
        color: AppTheme.ground,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.line),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.qr_code_2, size: 56, color: AppTheme.lineStrong),
          const SizedBox(height: 8),
          const Text('الـ QR غير متاح حاليًا',
              style: TextStyle(color: AppTheme.muted)),
          TextButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('إعادة المحاولة'),
          ),
        ],
      ),
    );
  }
}
