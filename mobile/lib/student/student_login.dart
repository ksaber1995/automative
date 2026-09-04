import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/qr.dart';
import '../core/theme.dart';
import '../models/student_models.dart';
import 'student_home.dart';
import 'student_session.dart';

/// Sign in with the credentials chosen at claim time, or claim a fresh card by
/// scanning it — the same two doors the web portal offers, on one screen.
class StudentLoginScreen extends StatefulWidget {
  const StudentLoginScreen({super.key});

  @override
  State<StudentLoginScreen> createState() => _StudentLoginScreenState();
}

class _StudentLoginScreenState extends State<StudentLoginScreen> {
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    final id = _identifier.text.trim();
    final pw = _password.text;
    if (id.isEmpty || pw.isEmpty) {
      setState(() => _error = 'اكتب اسم المستخدم وكلمة المرور.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<StudentSession>().login(id, pw);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const StudentHome()));
    } on ApiException catch (e) {
      setState(() {
        _busy = false;
        _error = e.statusCode == 401
            ? 'اسم المستخدم أو كلمة المرور غير صحيحة.'
            : e.message;
      });
    } catch (_) {
      setState(() {
        _busy = false;
        _error = 'تعذر الاتصال — تأكد من الإنترنت وحاول مجددًا.';
      });
    }
  }

  void _scanCard() {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const _ClaimScanScreen()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SingleChildScrollView(
        child: Column(
          children: [
            Container(
              width: double.infinity,
              padding: EdgeInsets.only(
                  top: MediaQuery.of(context).padding.top + 16, bottom: 40),
              decoration: const BoxDecoration(
                gradient: AppTheme.headerGradient,
                borderRadius: BorderRadius.vertical(bottom: Radius.circular(36)),
              ),
              child: Column(
                children: [
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: IconButton(
                      icon: const Icon(Icons.arrow_back, color: Colors.white),
                      onPressed: () => Navigator.of(context).maybePop(),
                    ),
                  ),
                  const Icon(Icons.school, size: 64, color: Colors.white),
                  const SizedBox(height: 12),
                  Text('بوابة الطالب',
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          color: Colors.white, fontWeight: FontWeight.w800)),
                  Text('سجّل دخولك لحل الامتحانات ومتابعة نتائجك',
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: Colors.white70)),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: _identifier,
                    textDirection: TextDirection.ltr,
                    decoration: const InputDecoration(
                      labelText: 'اسم المستخدم',
                      prefixIcon: Icon(Icons.person_outline),
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _password,
                    obscureText: _obscure,
                    textDirection: TextDirection.ltr,
                    decoration: InputDecoration(
                      labelText: 'كلمة المرور',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        icon: Icon(
                            _obscure ? Icons.visibility : Icons.visibility_off),
                        onPressed: () => setState(() => _obscure = !_obscure),
                      ),
                    ),
                    onSubmitted: (_) => _login(),
                  ),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(_error!,
                          style: const TextStyle(color: AppTheme.red)),
                    ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _busy ? null : _login,
                    child: _busy
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                                strokeWidth: 2.5, color: Colors.white))
                        : const Text('تسجيل الدخول'),
                  ),
                  const SizedBox(height: 28),
                  Row(children: [
                    const Expanded(child: Divider()),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Text('أول مرة؟',
                          style: TextStyle(color: Colors.grey[600])),
                    ),
                    const Expanded(child: Divider()),
                  ]),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16)),
                      side: const BorderSide(color: AppTheme.indigo),
                    ),
                    icon: const Icon(Icons.qr_code_scanner,
                        color: AppTheme.indigo),
                    label: const Text('امسح بطاقتك لتفعيل حسابك',
                        style: TextStyle(
                            color: AppTheme.indigo,
                            fontWeight: FontWeight.w700)),
                    onPressed: _scanCard,
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

/// Scan the student's own card to begin the claim.
class _ClaimScanScreen extends StatefulWidget {
  const _ClaimScanScreen();

  @override
  State<_ClaimScanScreen> createState() => _ClaimScanScreenState();
}

class _ClaimScanScreenState extends State<_ClaimScanScreen> {
  final _scanner =
      MobileScannerController(detectionSpeed: DetectionSpeed.noDuplicates);
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _scanner.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_busy) return;
    for (final barcode in capture.barcodes) {
      final token = extractQrToken(barcode.rawValue ?? '');
      if (token == null) continue;
      setState(() {
        _busy = true;
        _error = null;
      });
      try {
        final claim = await context.read<StudentSession>().claimStart(token);
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
            MaterialPageRoute(builder: (_) => _ClaimFinishScreen(claim: claim)));
      } on ApiException catch (e) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      } catch (_) {
        setState(() {
          _busy = false;
          _error = 'تعذر التحقق من البطاقة — حاول مجددًا.';
        });
      }
      return;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.ink,
      appBar: AppBar(title: const Text('امسح بطاقتك')),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(controller: _scanner, onDetect: _onDetect),
          Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white70, width: 3),
                borderRadius: BorderRadius.circular(24),
              ),
            ),
          ),
          if (_busy)
            Container(
              color: Colors.black45,
              child: const Center(
                  child: CircularProgressIndicator(color: Colors.white)),
            ),
          if (_error != null)
            Positioned(
              bottom: 32,
              left: 24,
              right: 24,
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Text(_error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: AppTheme.red)),
              ),
            ),
        ],
      ),
    );
  }
}

/// After a good scan: choose credentials (first claim) or type the existing
/// ones (re-claiming on a new phone).
class _ClaimFinishScreen extends StatefulWidget {
  const _ClaimFinishScreen({required this.claim});

  final ClaimStart claim;

  @override
  State<_ClaimFinishScreen> createState() => _ClaimFinishScreenState();
}

class _ClaimFinishScreenState extends State<_ClaimFinishScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    final user = _username.text.trim();
    final pw = _password.text;
    if (user.isEmpty || pw.length < 6) {
      setState(() => _error = 'اكتب اسم مستخدم وكلمة مرور (٦ أحرف على الأقل).');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context
          .read<StudentSession>()
          .claimFinish(widget.claim.claimTicket, user, pw);
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const StudentHome()),
          (route) => route.isFirst);
    } on ApiException catch (e) {
      setState(() {
        _busy = false;
        _error = e.message;
      });
    } catch (_) {
      setState(() {
        _busy = false;
        _error = 'تعذر إتمام التفعيل — حاول مجددًا.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final firstTime = !widget.claim.hasCredentials;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppTheme.indigo,
        title: const Text('تفعيل الحساب'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('أهلًا ${widget.claim.studentName} 👋',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Text(
              firstTime
                  ? 'اختر اسم مستخدم وكلمة مرور لحسابك — ستستخدمهما في كل مرة.'
                  : 'هذا الحساب مفعّل من قبل — اكتب اسم المستخدم وكلمة المرور اللذين اخترتهما.',
              style: TextStyle(color: Colors.grey[700]),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _username,
              textDirection: TextDirection.ltr,
              decoration: const InputDecoration(
                labelText: 'اسم المستخدم',
                prefixIcon: Icon(Icons.person_outline),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _password,
              obscureText: _obscure,
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(
                labelText: 'كلمة المرور',
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(
                  icon:
                      Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                  onPressed: () => setState(() => _obscure = !_obscure),
                ),
              ),
              onSubmitted: (_) => _finish(),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child:
                    Text(_error!, style: const TextStyle(color: AppTheme.red)),
              ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy ? null : _finish,
              child: _busy
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                          strokeWidth: 2.5, color: Colors.white))
                  : Text(firstTime ? 'تفعيل ودخول' : 'دخول'),
            ),
          ],
        ),
      ),
    );
  }
}
