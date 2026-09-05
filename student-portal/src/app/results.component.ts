import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { I18nService } from './i18n.service';
import { StudentExamsService, ResultRow } from './student-exams.service';

/**
 * Every recorded mark — online and offline exams and homework alike, because
 * the feed behind this is the same one the staff app and the QR profile read.
 */
@Component({
  selector: 'app-results',
  standalone: true,
  imports: [RouterLink, DatePipe],
  template: `
    <div class="card">
      <h1>{{ i18n.t('RESULTS.HEADING') }}</h1>
      <a routerLink="/exams" class="link">{{ i18n.t('RESULTS.BACK') }}</a>
    </div>

    @if (loading()) {
      <div class="card empty"><p class="muted">{{ i18n.t('EXAMS.LOADING') }}</p></div>
    } @else if (!rows().length) {
      <div class="card empty">
        <div class="glyph">🏅</div>
        <h2>{{ i18n.t('RESULTS.EMPTY') }}</h2>
      </div>
    }

    @for (row of rows(); track $index) {
      <div class="card" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div>
          <p style="font-weight:600; margin:0;">
            {{ row.examName }}
            @if (row.isHomework) { <span class="hw">{{ i18n.t('RESULTS.HOMEWORK') }}</span> }
          </p>
          <p class="muted" style="margin:2px 0 0;">
            {{ row.courseName }}
            @if (row.examDate) { · {{ row.examDate | date: 'mediumDate' }} }
          </p>
        </div>
        <div style="text-align:end; white-space:nowrap;">
          @if (row.isAbsent) {
            <span class="mark mark-absent">{{ i18n.t(row.isHomework ? 'RESULTS.NOT_DONE' : 'RESULTS.ABSENT') }}</span>
          } @else if (row.notMarked) {
            <span class="mark mark-pending">{{ i18n.t('RESULTS.NOT_MARKED') }}</span>
          } @else {
            <span class="mark">{{ row.grade }}@if (row.maxGrade !== null) {<span class="muted">/{{ row.maxGrade }}</span>}</span>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .hw { background: #e0e7ff; color: #3730a3; border-radius: 999px; padding: 2px 8px;
          font-size: .72rem; font-weight: 400; margin-inline-start: 6px; }
    .mark { font-weight: 700; font-size: 1.1rem; }
    .mark-absent { color: var(--danger); font-size: .9rem; }
    .mark-pending { color: var(--muted); font-size: .9rem; font-weight: 400; }
  `],
})
export class ResultsComponent implements OnInit {
  i18n = inject(I18nService);
  private svc = inject(StudentExamsService);

  loading = signal(true);
  rows = signal<ResultRow[]>([]);

  ngOnInit(): void {
    this.svc.results().subscribe({
      next: (rows) => { this.rows.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
