import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { I18nService } from './i18n.service';
import { StudentAuthService } from './auth/student-auth.service';
import { StudentExamsService, StudentExamListItem } from './student-exams.service';

/**
 * The signed-in home: every exam the student may sit, with their own state on
 * each card — Start (behind the access-code field only when the exam wants
 * one), Continue, or the score. A start that answers 409 ALREADY_SUBMITTED
 * routes straight to the result screen instead of erroring.
 */
@Component({
  selector: 'app-exams',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div>
          <h1>{{ i18n.t('EXAMS.HEADING') }}</h1>
          <p class="muted">{{ auth.student()?.name }}</p>
        </div>
        <button type="button" class="btn ghost" style="width:auto; margin:0; padding:8px 14px;" (click)="signOut()">
          {{ i18n.t('EXAMS.SIGN_OUT') }}
        </button>
      </div>
      <a routerLink="/results" class="link">{{ i18n.t('EXAMS.MY_RESULTS') }}</a>
    </div>

    @if (loading()) {
      <div class="card empty"><p class="muted">{{ i18n.t('EXAMS.LOADING') }}</p></div>
    } @else if (!items().length) {
      <div class="card empty">
        <div class="glyph">📝</div>
        <h2>{{ i18n.t('EXAMS.EMPTY') }}</h2>
        <p class="muted">{{ i18n.t('EXAMS.EMPTY_SUB') }}</p>
      </div>
    }

    @for (item of items(); track item.examId) {
      <div class="card">
        <div style="display:flex; align-items:start; justify-content:space-between; gap:8px;">
          <div>
            <h2>{{ item.name }}</h2>
            <p class="muted">{{ item.courseName }}</p>
          </div>
          @if (item.state === 'IN_PROGRESS') {
            <span class="chip chip-live">{{ i18n.t('EXAMS.IN_PROGRESS') }}</span>
          } @else if (item.state === 'DONE') {
            <span class="chip chip-done">{{ i18n.t('EXAMS.DONE') }}</span>
          }
        </div>

        <p class="muted">
          {{ item.questionCount }} {{ i18n.t('EXAMS.QUESTIONS') }}
          @if (item.durationMinutes) { · {{ item.durationMinutes }} {{ i18n.t('EXAMS.MINUTES') }} }
          @if (item.closesAt) { · {{ i18n.t('EXAMS.CLOSES') }} {{ item.closesAt | date: 'short' }} }
        </p>

        @switch (item.state) {
          @case ('AVAILABLE') {
            @if (item.requiresCode) {
              <input
                [placeholder]="i18n.t('EXAMS.CODE_PLACEHOLDER')"
                [(ngModel)]="codes[item.examId]"
                autocapitalize="characters"
                autocomplete="off"
                style="text-transform: uppercase;"
              />
            }
            <button type="button" class="btn" (click)="start(item)"
                    [disabled]="busyId() === item.examId || (item.requiresCode && !(codes[item.examId] || '').trim())">
              {{ i18n.t(busyId() === item.examId ? 'EXAMS.STARTING' : 'EXAMS.START') }}
            </button>
          }
          @case ('IN_PROGRESS') {
            <button type="button" class="btn" (click)="resume(item)" [disabled]="busyId() === item.examId">
              {{ i18n.t('EXAMS.CONTINUE') }}
            </button>
          }
          @case ('DONE') {
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <strong style="font-size:1.3rem;">{{ item.score }}/{{ item.total }}</strong>
              <button type="button" class="btn secondary" style="width:auto; margin:0; padding:9px 16px;"
                      (click)="viewResult(item)">
                {{ i18n.t('EXAMS.VIEW_RESULT') }}
              </button>
            </div>
          }
        }

        @if (errors[item.examId]) { <div class="error">{{ errors[item.examId] }}</div> }
      </div>
    }
  `,
  styles: [`
    .chip { border-radius: 999px; padding: 4px 10px; font-size: .78rem; white-space: nowrap; }
    .chip-live { background: #fef9c3; color: #854d0e; }
    .chip-done { background: #dcfce7; color: #166534; }
  `],
})
export class ExamsComponent implements OnInit {
  i18n = inject(I18nService);
  auth = inject(StudentAuthService);
  private svc = inject(StudentExamsService);
  private router = inject(Router);

  loading = signal(true);
  items = signal<StudentExamListItem[]>([]);
  busyId = signal<string | null>(null);
  codes: Record<string, string> = {};
  errors: Record<string, string> = {};

  ngOnInit(): void {
    if (!this.auth.student()) {
      this.auth.me().subscribe({
        next: (me) => this.auth.student.set({ name: me.name, username: me.username }),
        error: () => {},
      });
    }
    this.svc.list().subscribe({
      next: (items) => { this.items.set(items); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  start(item: StudentExamListItem): void {
    this.errors[item.examId] = '';
    this.busyId.set(item.examId);
    this.svc.start(item.examId, (this.codes[item.examId] || '').trim() || undefined).subscribe({
      next: (attempt) => {
        this.svc.activeAttempt.set({ examId: item.examId, attempt });
        this.router.navigate(['/exams', item.examId, 'sit']);
      },
      error: (err) => this.startFailed(item, err),
    });
  }

  resume(item: StudentExamListItem): void {
    this.errors[item.examId] = '';
    this.busyId.set(item.examId);
    this.svc.attempt(item.examId).subscribe({
      next: (attempt) => {
        this.svc.activeAttempt.set({ examId: item.examId, attempt });
        this.router.navigate(['/exams', item.examId, 'sit']);
      },
      error: (err) => this.startFailed(item, err),
    });
  }

  viewResult(item: StudentExamListItem): void {
    this.router.navigate(['/exams', item.examId, 'result']);
  }

  signOut(): void {
    this.auth.logout();
    this.router.navigate(['/']);
  }

  private startFailed(item: StudentExamListItem, err: any): void {
    this.busyId.set(null);
    // Already finished (maybe on another device, maybe the clock ran out while
    // the tab was closed) — that's a result to show, not an error.
    if (err?.error?.code === 'ERRORS.EXAMS.ALREADY_SUBMITTED') {
      this.router.navigate(['/exams', item.examId, 'result']);
      return;
    }
    this.errors[item.examId] = this.i18n.fromError(err);
  }
}
