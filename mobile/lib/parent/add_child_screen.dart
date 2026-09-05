import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';

import '../core/qr.dart';
import '../core/theme.dart';
import 'child_dashboard.dart';
import 'children_store.dart';
import 'notifications.dart';

/// Scan the card (or paste its link) to add a child. The scanner fills the
/// screen; the manual entry lives under it for the card-less moment — a photo
/// of the card, a forwarded link.
class AddChildScreen extends StatefulWidget {
  const AddChildScreen({super.key});

  @override
  State<AddChildScreen> createState() => _AddChildScreenState();
}

class _AddChildScreenState extends State<AddChildScreen> {
  final _manual = TextEditingController();
  final _scanner = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
  );

  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _manual.dispose();
    _scanner.dispose();
    super.dispose();
  }

  Future<void> _useToken(String token) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final store = context.read<ChildrenStore>();
      final profile = await store.addByToken(token);
      // Set this child's notification high-water mark right away, so events
      // from the very next minute announce themselves instead of being read
      // as pre-install backlog on the first poll.
      unawaited(checkAndNotifyAllChildren());
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => ChildDashboard(token: token, initial: profile),
      ));
    } catch (e) {
      setState(() {
        _busy = false;
        _error = 'لم نجد هذه البطاقة — تأكد من الكود وحاول مرة أخرى.';
      });
    }
  }

  void _onDetect(BarcodeCapture capture) {
    for (final barcode in capture.barcodes) {
      final token = extractQrToken(barcode.rawValue ?? '');
      if (token != null) {
        _useToken(token);
        return;
      }
    }
  }

  void _onManual() {
    final token = extractQrToken(_manual.text);
    if (token == null) {
      setState(() => _error = 'الرابط أو الكود غير صحيح.');
      return;
    }
    _useToken(token);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.ink,
      appBar: AppBar(title: const Text('إضافة ابن / ابنة')),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                MobileScanner(controller: _scanner, onDetect: _onDetect),
                // Framing guide so the parent knows what to point at.
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
              ],
            ),
          ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('وجّه الكاميرا نحو كود QR على بطاقة الطالب',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text('أو اكتب الكود / الصق الرابط يدويًا:',
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: AppTheme.muted)),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _manual,
                        textDirection: TextDirection.ltr,
                        decoration: const InputDecoration(
                          hintText: 'https://app.netrofit.com/p/s/…',
                          isDense: true,
                        ),
                        onSubmitted: (_) => _onManual(),
                      ),
                    ),
                    const SizedBox(width: 10),
                    FilledButton(
                      style: FilledButton.styleFrom(
                          minimumSize: const Size(88, 48)),
                      onPressed: _busy ? null : _onManual,
                      child: const Text('إضافة'),
                    ),
                  ],
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Text(_error!,
                        style: const TextStyle(color: AppTheme.red)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
