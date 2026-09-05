import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api.dart';
import '../core/theme.dart';
import '../models/student_models.dart';
import 'exam_result_screen.dart';
import 'student_session.dart';

/// Sitting the paper: one question per page, every tap saved to the server the
/// moment it lands (a dead battery mid-exam must lose nothing), a countdown
/// driven by the SERVER clock, and auto-submit when time runs out.
class ExamSitScreen extends StatefulWidget {
  const ExamSitScreen({
    super.key,
    required this.examId,
    required this.resume,
    this.accessCode,
  });

  final String examId;
  final bool resume;
  final String? accessCode;

  @override
  State<ExamSitScreen> createState() => _ExamSitScreenState();
}

class _ExamSitScreenState extends State<ExamSitScreen> {
  final _pager = PageController();

  StudentAttempt? _attempt;
  String? _error;
  int _page = 0;
  Duration? _remaining;
  Timer? _ticker;
  bool _submitting = false;

  StudentExamsApi get _api =>
      StudentExamsApi(context.read<StudentSession>().api);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _pager.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final attempt = widget.resume
          ? await _api.attempt(widget.examId)
          : await _api.start(widget.examId, accessCode: widget.accessCode);
      if (!mounted) return;
      setState(() {
        _attempt = attempt;
        _remaining = attempt.remaining;
      });
      _startTicker();
    } on ApiException catch (e) {
      if (!mounted) return;
      // Started on another device / already open: resume instead of failing.
      if (e.statusCode == 409 && !widget.resume) {
        try {
          final attempt = await _api.attempt(widget.examId);
          if (!mounted) return;
          setState(() {
            _attempt = attempt;
            _remaining = attempt.remaining;
          });
          _startTicker();
          return;
        } catch (_) {}
      }
      setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذر فتح الامتحان — حاول مجددًا.');
    }
  }

  void _startTicker() {
    if (_remaining == null) return;
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      final r = _remaining;
      if (r == null) return;
      if (r.inSeconds <= 1) {
        _ticker?.cancel();
        setState(() => _remaining = Duration.zero);
        // Time is up server-side too; hand in whatever was saved.
        _submit(auto: true);
      } else {
        setState(() => _remaining = r - const Duration(seconds: 1));
      }
    });
  }

  Future<void> _pick(PaperQuestion q, PaperOption o) async {
    final previous = q.selectedOptionId;
    setState(() => q.selectedOptionId = o.id); // optimistic — feels instant
    try {
      await _api.answer(widget.examId, q.id, o.id);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => q.selectedOptionId = previous);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      if (!mounted) return;
      setState(() => q.selectedOptionId = previous);
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('لم تُحفظ الإجابة — تأكد من الإنترنت.')));
    }
  }

  Future<void> _confirmSubmit() async {
    final attempt = _attempt!;
    final unanswered =
        attempt.questions.where((q) => q.selectedOptionId == null).length;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('تسليم الامتحان؟'),
        content: Text(unanswered == 0
            ? 'أجبت على كل الأسئلة. بعد التسليم لا يمكن التعديل.'
            : 'لديك $unanswered سؤال بدون إجابة. بعد التسليم لا يمكن التعديل.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('رجوع')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(96, 44)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('تسليم'),
          ),
        ],
      ),
    );
    if (ok == true) _submit();
  }

  Future<void> _submit({bool auto = false}) async {
    if (_submitting) return;
    setState(() => _submitting = true);
    try {
      final result = await _api.submit(widget.examId);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => ExamResultScreen(
            result: result, examName: _attempt?.examName ?? ''),
      ));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      if (!mounted) return;
      setState(() => _submitting = false);
      if (!auto) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تعذر التسليم — حاول مجددًا.')));
      }
    }
  }

  String _clock(Duration d) {
    final m = d.inMinutes.toString().padLeft(2, '0');
    final s = (d.inSeconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final attempt = _attempt;
    if (attempt == null) {
      return Scaffold(
        appBar:
            AppBar(backgroundColor: AppTheme.chrome, title: const Text('الامتحان')),
        body: Center(
          child: _error == null
              ? const CircularProgressIndicator()
              : Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(_error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppTheme.red)),
                ),
        ),
      );
    }

    final total = attempt.questions.length;
    final answered =
        attempt.questions.where((q) => q.selectedOptionId != null).length;
    final urgent = _remaining != null && _remaining!.inSeconds <= 60;

    return PopScope(
      // Leaving mid-paper is allowed (answers are saved), but signal the list
      // to refresh so the exam shows as IN_PROGRESS.
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(true);
      },
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: AppTheme.chrome,
          title: Text(attempt.examName,
              style:
                  const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          actions: [
            if (_remaining != null)
              Center(
                child: Container(
                  margin: const EdgeInsetsDirectional.only(end: 12),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: urgent ? AppTheme.red : Colors.white24,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    _clock(_remaining!),
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontFeatures: []),
                  ),
                ),
              ),
          ],
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(6),
            child: LinearProgressIndicator(
              value: total == 0 ? 0 : answered / total,
              minHeight: 6,
              backgroundColor: Colors.white24,
              valueColor: const AlwaysStoppedAnimation(Colors.white),
            ),
          ),
        ),
        body: Column(
          children: [
            Expanded(
              child: PageView.builder(
                controller: _pager,
                onPageChanged: (i) => setState(() => _page = i),
                itemCount: total,
                itemBuilder: (context, i) =>
                    _QuestionPage(
                      question: attempt.questions[i],
                      index: i,
                      total: total,
                      onPick: _pick,
                    ),
              ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Row(
                  children: [
                    if (_page > 0)
                      OutlinedButton(
                        onPressed: () => _pager.previousPage(
                            duration: const Duration(milliseconds: 250),
                            curve: Curves.easeOut),
                        child: const Text('السابق'),
                      ),
                    const Spacer(),
                    Text('${_page + 1} / $total',
                        style: TextStyle(
                            color: AppTheme.muted,
                            fontWeight: FontWeight.w700)),
                    const Spacer(),
                    if (_page < total - 1)
                      FilledButton(
                        style: FilledButton.styleFrom(
                            minimumSize: const Size(110, 48)),
                        onPressed: () => _pager.nextPage(
                            duration: const Duration(milliseconds: 250),
                            curve: Curves.easeOut),
                        child: const Text('التالي'),
                      )
                    else
                      FilledButton.icon(
                        style: FilledButton.styleFrom(
                            minimumSize: const Size(120, 48),
                            backgroundColor: AppTheme.green),
                        onPressed: _submitting ? null : _confirmSubmit,
                        icon: const Icon(Icons.check),
                        label: const Text('تسليم'),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuestionPage extends StatelessWidget {
  const _QuestionPage({
    required this.question,
    required this.index,
    required this.total,
    required this.onPick,
  });

  final PaperQuestion question;
  final int index;
  final int total;
  final void Function(PaperQuestion, PaperOption) onPick;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text('سؤال ${index + 1} من $total',
            style: TextStyle(color: AppTheme.muted)),
        const SizedBox(height: 8),
        Text(question.questionText,
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w800, height: 1.5)),
        const SizedBox(height: 20),
        for (final option in question.options)
          _OptionCard(
            option: option,
            selected: question.selectedOptionId == option.id,
            onTap: () => onPick(question, option),
          ),
      ],
    );
  }
}

class _OptionCard extends StatelessWidget {
  const _OptionCard({
    required this.option,
    required this.selected,
    required this.onTap,
  });

  final PaperOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: selected ? AppTheme.primary.withValues(alpha: 0.08) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: selected ? AppTheme.primary : AppTheme.line,
                width: selected ? 2 : 1,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  selected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  color: selected ? AppTheme.primary : Colors.grey,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(option.text,
                      style: TextStyle(
                          fontSize: 16,
                          height: 1.4,
                          fontWeight:
                              selected ? FontWeight.w700 : FontWeight.w500)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
