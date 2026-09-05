import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/student_models.dart';

/// The moment after submit: the score, big — then the full review when the
/// teacher allowed answers to be shown.
class ExamResultScreen extends StatelessWidget {
  const ExamResultScreen(
      {super.key, required this.result, required this.examName});

  final SubmitResult result;
  final String examName;

  @override
  Widget build(BuildContext context) {
    final pct = result.total == 0 ? 0.0 : result.score / result.total;
    final (color, word) = pct >= 0.85
        ? (AppTheme.green, 'ممتاز! 🎉')
        : pct >= 0.6
            ? (AppTheme.amber, 'جيد 👍')
            : (AppTheme.red, 'يحتاج مراجعة 💪');

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(
            child: Container(
              width: double.infinity,
              padding: EdgeInsets.only(
                  top: MediaQuery.of(context).padding.top + 16, bottom: 32),
              decoration: const BoxDecoration(
                gradient: AppTheme.headerGradient,
                borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
              ),
              child: Column(
                children: [
                  Text(examName,
                      style: const TextStyle(
                          color: Colors.white70, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 16),
                  Text(
                    '${_trim(result.score)} / ${_trim(result.total)}',
                    textDirection: TextDirection.ltr,
                    style: Theme.of(context)
                        .textTheme
                        .displayMedium
                        ?.copyWith(
                            color: Colors.white, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(word,
                        style: TextStyle(
                            color: color, fontWeight: FontWeight.w800)),
                  ),
                ],
              ),
            ),
          ),
          if (result.showAnswers && result.questions.isNotEmpty)
            SliverPadding(
              padding: const EdgeInsets.all(16),
              sliver: SliverList.separated(
                itemCount: result.questions.length,
                separatorBuilder: (_, _) => const SizedBox(height: 12),
                itemBuilder: (context, i) =>
                    _ReviewCard(index: i, q: result.questions[i]),
              ),
            )
          else
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Text(
                  'أجوبة هذا الامتحان غير متاحة للمراجعة.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppTheme.muted),
                ),
              ),
            ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
              child: FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('العودة للامتحانات'),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _trim(double v) =>
      v.truncateToDouble() == v ? v.toInt().toString() : v.toString();
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.index, required this.q});

  final int index;
  final ReviewQuestion q;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(q.isCorrect ? Icons.check_circle : Icons.cancel,
                    color: q.isCorrect ? AppTheme.green : AppTheme.red),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('${index + 1}. ${q.questionText}',
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, height: 1.4)),
                ),
              ],
            ),
            const SizedBox(height: 12),
            for (final o in q.options) _reviewOption(o),
            if (q.explanation != null && q.explanation!.isNotEmpty) ...[
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.primary.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text('التفسير: ${q.explanation}',
                    style: const TextStyle(height: 1.5)),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _reviewOption(ReviewOption o) {
    final chosen = o.id == q.selectedOptionId;
    final Color color;
    final IconData icon;
    if (o.isCorrect) {
      color = AppTheme.green;
      icon = Icons.check_circle_outline;
    } else if (chosen) {
      color = AppTheme.red;
      icon = Icons.highlight_off;
    } else {
      color = Colors.grey;
      icon = Icons.radio_button_unchecked;
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              o.text,
              style: TextStyle(
                color: color == Colors.grey ? AppTheme.muted : color,
                fontWeight:
                    o.isCorrect || chosen ? FontWeight.w700 : FontWeight.w400,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
