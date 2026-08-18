import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { I18nService } from './i18n.service';
import { StudentExamsService, PaperQuestion, StudentAttempt } from './student-exams.service';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * Sitting the paper. One question per screen with big tap targets, a dot strip
 * of answered/unanswered, and a countdown driven off the SERVER's expiresAt +
 * serverNow — the device clock only measures the time since the payload
 * arrived, it is never trusted for the deadline itself. Picking an option
 * autosaves immediately; Submit sits behind a confirm that names how many
 * questions are still unanswered. When the clock hits zero the paper submits
 * itself — the server grades whatever was saved.
 */
@Component({
  selector: 'app-exam-sit',
  standalone: true,
  imports: [],
  template: `
    @if (!attempt()) {
      <div class="card empty"><p class="muted">{{ i18n.t('EXAMS.LOADING') }}</p></div>
    } @else {
      <div class="card sticky-head">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div>
            <h2>{{ attempt()!.exam.name }}</h2>
            <p class="muted" style="margin:0;">
              {{ i18n.t('SIT.QUESTION') }} {{ idx() + 1 }} / {{ questions().length }}
            </p>
          </div>
          <div class="clock" [class.clock-low]="remainingMs() < 120000">{{ clockText() }}</div>
        </div>
        <div class="dots">
          @for (q of questions(); track q.id; let i = $index) {
            <button type="button" class="dot"
                    [class.dot-answered]="q.selectedOptionId"
                    [class.dot-current]="i === idx()"
                    (click)="idx.set(i)"></button>
          }
        </div>
      </div>

      @if (timeUp()) {
        <div class="card empty"><p class="muted">{{ i18n.t('SIT.TIME_UP') }}</p></div>
      } @else if (!confirming()) {
        <div class="card">
          <h2 style="line-height:1.5;">{{ current().questionText }}</h2>
          @for (opt of current().options; track opt.id) {
            <button type="button" class="option"
                    [class.option-picked]="current().selectedOptionId === opt.id"
                    (click)="pick(opt.id)">
              {{ opt.text }}
            </button>
          }
          <p class="muted save-note">
            @switch (saveState()) {
              @case ('saving') { {{ i18n.t('SIT.SAVING') }} }
              @case ('saved') { {{ i18n.t('SIT.SAVED') }} }
              @case ('failed') { <span style="color: var(--danger);">{{ i18n.t('SIT.SAVE_FAILED') }}</span> }
            }
          </p>
        </div>

        <div class="card" style="display:flex; gap:8px;">
          <button type="button" class="btn ghost" style="margin:0;" [disabled]="idx() === 0" (click)="idx.set(idx() - 1)">
            {{ i18n.t('SIT.PREV') }}
          </button>
          @if (idx() < questions().length - 1) {
            <button type="button" class="btn" style="margin:0;" (click)="idx.set(idx() + 1)">
              {{ i18n.t('SIT.NEXT') }}
            </button>
          } @else {
            <button type="button" class="btn" style="margin:0;" (click)="confirming.set(true)">
              {{ i18n.t('SIT.SUBMIT') }}
            </button>
          }
        </div>
        <button type="button" class="btn secondary" (click)="confirming.set(true)">{{ i18n.t('SIT.SUBMIT') }}</button>
      } @else {
        <div class="card" style="text-align:center; padding-block:26px;">
          <h2>{{ i18n.t('SIT.CONFIRM_TITLE') }}</h2>
          <p class="muted">
            @if (unanswered() > 0) { {{ i18n.tp('SIT.CONFIRM_UNANSWERED', { n: unanswered() }) }} }
            @else { {{ i18n.t('SIT.CONFIRM_ALL_ANSWERED') }} }
          </p>
          <button type="button" class="btn" [disabled]="submitting()" (click)="submit()">
            {{ i18n.t(submitting() ? 'SIT.SUBMITTING' : 'SIT.CONFIRM_YES') }}
          </button>
          <button type="button" class="btn ghost" [disabled]="submitting()" (click)="confirming.set(false)">
            {{ i18n.t('SIT.CONFIRM_NO') }}
          </button>
        </div>
      }
    }
  `,
  styles: [`
    .sticky-head { position: sticky; top: 0; z-index: 5; }
    .clock { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 1.15rem; direction: ltr; }
    .clock-low { color: var(--danger); }
    .dots { display: flex; flex-wrap: wrap; gap: 6px; margin-block-start: 10px; }
    .dot { width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--border);
           background: transparent; padding: 0; cursor: pointer; }
    .dot-answered { background: var(--accent); border-color: var(--accent); }
    .dot-current { outline: 2px solid var(--accent); outline-offset: 1px; }
    .option { display: block; width: 100%; text-align: start; margin-block-start: 10px;
              padding: 13px; font-size: 1rem; border-radius: 10px; cursor: pointer;
              border: 1px solid var(--border); background: var(--bg); color: var(--ink); }
    .option-picked { border-color: var(--accent); background: #eff6ff; font-weight: 600; }
    .save-note { min-height: 1.2em; margin-block: 10px 0; text-align: center; }
  `],
})
export class ExamSitComponent implements OnInit, OnDestroy {
  i18n = inject(I18nService);
  private svc = inject(StudentExamsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private examId = '';
  /** serverNow − deviceNow at payload receipt; added to Date.now() ever after. */
  private clockSkewMs = 0;
  private ticker: any;

  attempt = signal<StudentAttempt | null>(null);
  questions = signal<PaperQuestion[]>([]);
  idx = signal(0);
  remainingMs = signal(Number.MAX_SAFE_INTEGER);
  saveState = signal<SaveState>('idle');
  confirming = signal(false);
  submitting = signal(false);
  timeUp = signal(false);

  current = computed(() => this.questions()[this.idx()]);
  unanswered = computed(() => this.questions().filter((q) => !q.selectedOptionId).length);

  ngOnInit(): void {
    this.examId = this.route.snapshot.paramMap.get('examId') ?? '';
    const handed = this.svc.activeAttempt();
    if (handed && handed.examId === this.examId) {
      this.svc.activeAttempt.set(null);
      this.load(handed.attempt);
      return;
    }
    // A reload mid-paper: resume from the server, answers intact.
    this.svc.attempt(this.examId).subscribe({
      next: (attempt) => this.load(attempt),
      error: (err) => {
        if (err?.error?.code === 'ERRORS.EXAMS.ALREADY_SUBMITTED') {
          this.router.navigate(['/exams', this.examId, 'result']);
        } else {
          this.router.navigate(['/exams']);
        }
      },
    });
  }

  ngOnDestroy(): void {
    if (this.ticker) clearInterval(this.ticker);
  }

  pick(optionId: string): void {
    const q = this.current();
    if (!q || this.submitting() || this.timeUp()) return;
    // Optimistic: paint the choice now, let the autosave confirm it.
    this.questions.update((list) =>
      list.map((item) => (item.id === q.id ? { ...item, selectedOptionId: optionId } : item)),
    );
    this.saveState.set('saving');
    this.svc.answer(this.examId, q.id, optionId).subscribe({
      next: () => this.saveState.set('saved'),
      error: (err) => {
        const code = err?.error?.code;
        if (code === 'ERRORS.EXAMS.TIME_UP' || code === 'ERRORS.EXAMS.ALREADY_SUBMITTED') {
          this.router.navigate(['/exams', this.examId, 'result']);
          return;
        }
        this.saveState.set('failed');
      },
    });
  }

  submit(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.svc.submit(this.examId).subscribe({
      next: (result) => {
        this.svc.lastResult.set({ examId: this.examId, result });
        this.router.navigate(['/exams', this.examId, 'result']);
      },
      error: () => this.submitting.set(false),
    });
  }

  clockText(): string {
    const total = Math.max(0, Math.floor(this.remainingMs() / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  private load(attempt: StudentAttempt): void {
    this.attempt.set(attempt);
    this.questions.set(attempt.questions);
    // Land on the first unanswered question — that is where they left off.
    const firstOpen = attempt.questions.findIndex((q) => !q.selectedOptionId);
    this.idx.set(firstOpen >= 0 ? firstOpen : 0);
    this.clockSkewMs = new Date(attempt.serverNow).getTime() - Date.now();
    this.startClock(attempt.expiresAt);
  }

  private startClock(expiresAt: string | null): void {
    if (!expiresAt) return;
    const deadline = new Date(expiresAt).getTime();
    const tick = () => {
      const left = deadline - (Date.now() + this.clockSkewMs);
      this.remainingMs.set(left);
      if (left <= 0 && !this.timeUp()) {
        this.timeUp.set(true);
        clearInterval(this.ticker);
        // The server grades whatever was saved; this just fetches the outcome.
        this.submit();
      }
    };
    tick();
    this.ticker = setInterval(tick, 500);
  }
}
