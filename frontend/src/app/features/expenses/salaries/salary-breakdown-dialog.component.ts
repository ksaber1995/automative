import { Component, effect, inject, model, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { ExpenseService, SalaryPaymentBreakdown } from '../services/expense.service';
import { esc, kpi, openPrintWindow, section, th } from './print-report.util';

/**
 * "How was this salary calculated?" for ONE payment in the salary history —
 * opened from both the salaries history table and the employee detail page, so
 * the answer is identical wherever it's asked.
 *
 * The middle of the dialog changes with how the employee is paid (the student
 * payments behind a percentage withdrawal, the sessions behind a session-based
 * one, or just the month for a flat salary). The end never does: every payment
 * finishes with base + bonus − discount = paid, which is the line people are
 * usually actually checking.
 */
@Component({
  selector: 'app-salary-breakdown-dialog',
  standalone: true,
  imports: [CommonModule, TranslateModule, ButtonModule, DialogModule, TableModule, TagModule, AmountPipe],
  templateUrl: './salary-breakdown-dialog.component.html',
})
export class SalaryBreakdownDialogComponent {
  private expenseService = inject(ExpenseService);
  private translate = inject(TranslateService);
  private amount = new AmountPipe();

  /** Two-way visibility, driven by the parent. */
  visible = model<boolean>(false);
  /** The salary payment to explain. Setting it (re)loads the breakdown. */
  paymentId = model<string | null>(null);

  loading = signal(false);
  failed = signal(false);
  data = signal<SalaryPaymentBreakdown | null>(null);

  /**
   * What's currently loaded. A plain field, not a signal: the effect below would
   * otherwise depend on something it writes and re-run itself for nothing.
   */
  private loadedId: string | null = null;

  constructor() {
    effect(() => {
      const id = this.paymentId();
      if (!this.visible() || !id) return;
      // Reopening the same payment shouldn't refetch what's already on screen.
      if (this.loadedId === id) return;
      this.load(id);
    });
  }

  private load(id: string): void {
    this.loadedId = id;
    this.loading.set(true);
    this.failed.set(false);
    this.data.set(null);
    this.expenseService.getSalaryPaymentBreakdown(id).subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      // Forget it on failure, so reopening retries instead of showing the error forever.
      error: () => { this.loadedId = null; this.failed.set(true); this.loading.set(false); },
    });
  }

  isPercentage(): boolean { return this.data()?.salaryType === 'PERCENTAGE'; }
  isSessionBased(): boolean { return this.data()?.salaryType === 'SESSION_BASED'; }

  /**
   * Whether the student money in the window actually accounts for the base that
   * was drawn. It normally does, but a rate changed mid-window (or a payment
   * refunded after the withdrawal) makes it drift — better shown than hidden.
   */
  expectedShare(): number {
    const d = this.data();
    if (!d || d.percentageRate == null) return 0;
    return Math.round(d.linesTotal * d.percentageRate) / 100;
  }

  shareMismatch(): boolean {
    const d = this.data();
    if (!d || !this.isPercentage()) return false;
    return Math.abs(this.expectedShare() - d.payment.baseSalary) > 0.5;
  }

  /** Colour the source chip so the payment models are tellable apart. */
  sourceSeverity(source: string): 'success' | 'info' | 'warn' | 'secondary' {
    switch (source) {
      case 'MONTHLY': return 'info';
      case 'PACKAGE': return 'success';
      case 'SESSION': return 'warn';
      default: return 'secondary';
    }
  }

  print(): void {
    const d = this.data();
    if (!d) return;

    const t = (key: string, params?: object) => this.translate.instant(key, params);
    const money = (n: number) => this.amount.transform(n);
    const day = (iso: string | null) => (iso ? new DatePipe('en-US').transform(iso, 'MMM d, y') || '—' : '—');
    const rtl = (this.translate.currentLang || 'en').startsWith('ar');
    const p = d.payment;

    // The head of the report is the same for every salary type: what was paid,
    // when, and (for the types that have one) the rate it came from.
    const heading = `
      <h1>${esc(d.employeeName)}</h1>
      <div class="meta">${esc(t('EXPENSES.SALARIES.BRK_TITLE'))} · ${esc(day(p.date))} ·
        ${esc(t('EXPENSES.SALARIES.PCT_PRINTED_ON', { date: day(new Date().toISOString()) }))}</div>
      <div class="kpis">
        ${kpi(t('EXPENSES.SALARIES.BRK_AMOUNT_PAID'), money(p.amount))}
        ${kpi(t('EXPENSES.SALARIES.BRK_BASE'), money(p.baseSalary))}
        ${d.percentageRate != null ? kpi(t('EXPENSES.SALARIES.PCT_RATE'), `${d.percentageRate}%`) : ''}
        ${d.sessionRate != null ? kpi(t('EXPENSES.SALARIES.BRK_SESSION_RATE'), money(d.sessionRate)) : ''}
      </div>`;

    // The arithmetic every type ends on, spelled out rather than implied.
    const calc = `
      <h2>${esc(t('EXPENSES.SALARIES.BRK_HOW'))}</h2>
      <div class="calc">
        <div class="calc-row"><span>${esc(t('EXPENSES.SALARIES.BRK_BASE'))}</span><span>${esc(money(p.baseSalary))}</span></div>
        <div class="calc-row"><span>${esc(t('EMPLOYEES.DETAIL.COL_BONUS'))}</span><span>+ ${esc(money(p.bonusAmount))}</span></div>
        <div class="calc-row"><span>${esc(t('EMPLOYEES.DETAIL.COL_DISCOUNT'))}</span><span>− ${esc(money(p.discountAmount))}</span></div>
        <div class="calc-row total"><span>${esc(t('EXPENSES.SALARIES.BRK_AMOUNT_PAID'))}</span><span>${esc(money(p.amount))}</span></div>
      </div>
      ${p.adjustmentReason ? `<p class="meta">${esc(t('EMPLOYEES.DETAIL.COL_REASON'))}: "${esc(p.adjustmentReason)}"</p>` : ''}`;

    let detail = '';
    if (this.isPercentage()) {
      const rows = d.lines.map((l) => `
        <tr>
          <td>${esc(l.studentName)}</td>
          <td>${esc(l.className || '—')}${l.courseName ? `<div class="sub">${esc(l.courseName)}</div>` : ''}</td>
          <td>${esc(l.source)}</td>
          <td>${esc(day(l.paidAt))}</td>
          <td class="num">${money(l.amount)}</td>
          <td class="num">${money(l.share)}</td>
        </tr>`).join('');
      detail = `
        <p class="meta">${esc(d.windowStart
          ? t('EXPENSES.SALARIES.BRK_WINDOW', { from: day(d.windowStart), to: day(d.windowEnd) })
          : t('EXPENSES.SALARIES.BRK_WINDOW_OPEN', { to: day(d.windowEnd) }))}</p>
        ${section(
          t('EXPENSES.SALARIES.BRK_FUNDED_BY', { count: d.lines.length }),
          th([[t('EXPENSES.SALARIES.PCT_COL_STUDENT'), false], [t('EXPENSES.SALARIES.PCT_COL_CLASS'), false],
              [t('EXPENSES.SALARIES.PCT_COL_SOURCE'), false], [t('EXPENSES.SALARIES.PCT_COL_DATE'), false],
              [t('EXPENSES.SALARIES.PCT_COL_PAID'), true], [t('EXPENSES.SALARIES.PCT_COL_SHARE'), true]]),
          rows,
          t('EXPENSES.SALARIES.BRK_NO_LINES'),
          `<tfoot><tr><td colspan="4">${esc(t('EXPENSES.SALARIES.PCT_TOTAL'))}</td>
            <td class="num">${money(d.linesTotal)}</td><td class="num">${money(this.expectedShare())}</td></tr></tfoot>`
        )}`;
    } else if (this.isSessionBased()) {
      const rows = d.sessions.map((s) => `
        <tr>
          <td>${esc(day(s.date))}</td>
          <td>${esc(s.className || '—')}${s.courseName ? `<div class="sub">${esc(s.courseName)}</div>` : ''}</td>
          <td class="num">${s.studentsPresent}</td>
          <td class="num">${money(d.sessionRate || 0)}</td>
        </tr>`).join('');
      detail = section(
        t('EXPENSES.SALARIES.BRK_SESSIONS_COVERED', { count: d.sessions.length }),
        th([[t('EXPENSES.SALARIES.PCT_COL_DATE'), false], [t('EXPENSES.SALARIES.PCT_COL_CLASS'), false],
            [t('EXPENSES.SALARIES.BRK_COL_PRESENT'), true], [t('EXPENSES.SALARIES.BRK_COL_RATE'), true]]),
        rows,
        t('EXPENSES.SALARIES.BRK_NO_SESSIONS'),
        `<tfoot><tr><td colspan="3">${esc(t('EXPENSES.SALARIES.PCT_TOTAL'))}</td>
          <td class="num">${money(p.baseSalary)}</td></tr></tfoot>`
      );
    } else {
      detail = `<h2>${esc(t('EXPENSES.SALARIES.BRK_MONTHLY_TITLE'))}</h2>
        <p class="meta">${esc(t('EXPENSES.SALARIES.BRK_MONTHLY_NOTE', { month: d.monthLabel }))}</p>`;
    }

    openPrintWindow({
      title: `${d.employeeName} — ${t('EXPENSES.SALARIES.BRK_TITLE')}`,
      rtl,
      body: heading + detail + calc,
    });
  }
}
