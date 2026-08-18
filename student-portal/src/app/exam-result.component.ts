import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { I18nService } from './i18n.service';
import { StudentExamsService, SubmitResult } from './student-exams.service';

/**
 * The score, and — when the exam allows it — the per-question review. Fetches
 * through the submit endpoint when it wasn't handed the result by the sitting
 * screen: submit is idempotent on a finished attempt, so "show me my result
 * again" and "submit" are the same call on purpose.
 */
@Component({
  selector: 'app-exam-result',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (!result()) {
      <div class="card empty"><p class="muted">{{ i18n.t('EXAMS.LOADING') }}</p></div>
    } @else {
      <div class="card" style="text-align:center; padding-block:28px;">
        <p class="muted">{{ i18n.t('RESULT.HEADING') }}</p>
        <div class="score">{{ result()!.score }} <span class="muted">{{ i18n.t('RESULT.OUT_OF') }}</span> {{ result()!.total }}</div>
        <p class="muted" style="font-size:1.05rem;">{{ percent() }}%</p>
        @if (result()!.attemptStatus === 'EXPIRED') {
          <p class="notice">{{ i18n.t('RESULT.EXPIRED_NOTE') }}</p>
        }
      </div>

      @if (result()!.showAnswers && result()!.questions?.length) {
        <h2 style="margin-block:8px;">{{ i18n.t('RESULT.REVIEW') }}</h2>
        @for (q of result()!.questions!; track $index; let i = $index) {
          <div class="card">
            <p style="font-weight:600; margin:0 0 6px;">{{ i + 1 }}. {{ q.questionText }}</p>
            @for (opt of q.options; track opt.id) {
              <div class="review-option"
                   [class.ro-correct]="opt.isCorrect"
                   [class.ro-wrong]="!opt.isCorrect && q.selectedOptionId === opt.id">
                {{ opt.text }}
                @if (opt.isCorrect) { <span>✓</span> }
                @else if (q.selectedOptionId === opt.id) { <span>✗</span> }
              </div>
            }
            @if (!q.selectedOptionId) { <p class="muted" style="margin-block-start:6px;">{{ i18n.t('RESULT.NO_ANSWER') }}</p> }
            @if (q.explanation) { <p class="muted" style="margin-block-start:6px;">{{ q.explanation }}</p> }
          </div>
        }
      }

      <a routerLink="/exams" class="btn secondary" style="text-decoration:none; text-align:center;">
        {{ i18n.t('RESULT.BACK') }}
      </a>
    }
  `,
  styles: [`
    .score { font-size: 2.6rem; font-weight: 800; margin-block: 4px; }
    .review-option { display: flex; justify-content: space-between; gap: 8px;
                     border: 1px solid var(--border); border-radius: 8px;
                     padding: 9px 12px; margin-block-start: 6px; font-size: .95rem; }
    .ro-correct { border-color: #86efac; background: #f0fdf4; color: #166534; }
    .ro-wrong { border-color: #fca5a5; background: #fef2f2; color: #991b1b; }
  `],
})
export class ExamResultComponent implements OnInit {
  i18n = inject(I18nService);
  private svc = inject(StudentExamsService);
  private route = inject(ActivatedRoute);

  result = signal<SubmitResult | null>(null);

  ngOnInit(): void {
    const examId = this.route.snapshot.paramMap.get('examId') ?? '';
    const handed = this.svc.lastResult();
    if (handed && handed.examId === examId) {
      this.svc.lastResult.set(null);
      this.result.set(handed.result);
      return;
    }
    this.svc.submit(examId).subscribe({
      next: (result) => this.result.set(result),
      error: () => {},
    });
  }

  percent(): number {
    const r = this.result();
    if (!r || !r.total) return 0;
    return Math.round((r.score / r.total) * 100);
  }
}
