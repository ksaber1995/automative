import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { ExpenseService, PercentageBreakdown } from '../services/expense.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { esc, kpi, openPrintWindow, section, th } from '../../../core/utils/print-report.util';

/** One course's contribution to a percentage teacher's earnings. */
interface CourseRollup {
  course: string;
  students: number;
  payments: number;
  revenue: number;
  share: number;
}

/**
 * The full-page view of how a PERCENTAGE teacher's pay was arrived at, opened
 * in a new tab from the salaries dialog. Same numbers, but with room the dialog
 * doesn't have: a per-course revenue/student summary above the payment log, so
 * you can see which course is actually earning before reading 100 rows.
 *
 * Everything here is derived from the one breakdown call — the per-course
 * rollup is grouped client-side rather than asking the API for it twice.
 */
@Component({
  selector: 'app-percentage-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ButtonModule, CardModule, TableModule, TagModule, AmountPipe],
  templateUrl: './percentage-detail.component.html',
})
export class PercentageDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private expenseService = inject(ExpenseService);
  private employeeService = inject(EmployeeService);
  private translate = inject(TranslateService);
  private amount = new AmountPipe();

  loading = signal(true);
  notFound = signal(false);
  employeeName = signal('');
  data = signal<PercentageBreakdown | null>(null);

  lines = computed(() => this.data()?.lines ?? []);
  unpaid = computed(() => this.data()?.unpaid ?? []);

  studentCount = computed(() => new Set(this.lines().map((l) => l.studentName)).size);
  /** Heads, not rows — one student can owe for several months at once. */
  unpaidStudentCount = computed(() => new Set(this.unpaid().map((u) => u.studentName)).size);

  /** Revenue and headcount per course, biggest earner first. */
  courseRollup = computed<CourseRollup[]>(() => {
    const acc = new Map<string, { students: Set<string>; payments: number; revenue: number; share: number }>();
    for (const l of this.lines()) {
      const key = l.courseName || l.className || '—';
      let row = acc.get(key);
      if (!row) {
        row = { students: new Set<string>(), payments: 0, revenue: 0, share: 0 };
        acc.set(key, row);
      }
      row.students.add(l.studentName);
      row.payments += 1;
      row.revenue += l.amount;
      row.share += l.share;
    }
    return [...acc.entries()]
      .map(([course, r]) => ({
        course,
        students: r.students.size,
        payments: r.payments,
        revenue: r.revenue,
        share: r.share,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  });

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('employeeId');
    if (!id) {
      this.notFound.set(true);
      this.loading.set(false);
      return;
    }

    this.employeeService.getEmployeeById(id).subscribe({
      next: (e) => this.employeeName.set(`${e.firstName} ${e.lastName}`.trim()),
      error: () => {},
    });

    this.expenseService.getEmployeePercentageBreakdown(id).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  /** Print the whole report — same house style as the per-payment breakdown. */
  printReport(): void {
    const d = this.data();
    if (!d) return;

    const t = (key: string, params?: object) => this.translate.instant(key, params);
    const money = (n: number) => this.amount.transform(n);
    const day = (iso: string | null) => (iso ? new DatePipe('en-US').transform(iso, 'MMM d, y') || '—' : '—');
    const rtl = (this.translate.currentLang || 'en').startsWith('ar');

    const courseRows = this.courseRollup().map((c) => `
      <tr>
        <td>${esc(c.course)}</td>
        <td class="num">${c.students}</td>
        <td class="num">${c.payments}</td>
        <td class="num">${money(c.revenue)}</td>
        <td class="num">${money(c.share)}</td>
      </tr>`).join('');

    const unpaidRows = this.unpaid().map((u) => `
      <tr>
        <td>${esc(u.studentName)}</td>
        <td>${esc(u.className || '—')}${u.courseName ? `<div class="sub">${esc(u.courseName)}</div>` : ''}</td>
        <td>${esc(u.source)}</td>
        <td class="num">${u.attendedSessions}</td>
        <td>${esc(day(u.lastAttendedAt))}</td>
        <td class="num">${money(u.outstanding)}</td>
        <td class="num">${money(u.potentialShare)}</td>
      </tr>`).join('');

    const paidRows = this.lines().map((l) => `
      <tr>
        <td>${esc(l.studentName)}</td>
        <td>${esc(l.className || '—')}${l.courseName ? `<div class="sub">${esc(l.courseName)}</div>` : ''}</td>
        <td>${esc(l.source)}</td>
        <td>${esc(day(l.paidAt))}</td>
        <td class="num">${money(l.amount)}</td>
        <td class="num">${money(l.share)}</td>
      </tr>`).join('');

    const body = `
          <h1>${esc(this.employeeName())}</h1>
          <div class="meta">${esc(t('EXPENSES.SALARIES.PCT_TITLE'))} · ${d.percentageRate}% ·
            ${esc(t('EXPENSES.SALARIES.PCT_PRINTED_ON', { date: day(new Date().toISOString()) }))}</div>

          <div class="kpis">
            ${kpi(t('EXPENSES.SALARIES.PCT_TOTAL_PAID'), money(d.totalPaid),
                  t('EXPENSES.SALARIES.PCT_FROM_STUDENTS', { students: this.studentCount(), payments: this.lines().length }))}
            ${kpi(t('EXPENSES.SALARIES.PCT_ACCRUED'), money(d.accrued), `${d.percentageRate}% ${t('EXPENSES.SALARIES.PCT_OF_REVENUE')}`)}
            ${kpi(t('EXPENSES.SALARIES.PCT_WITHDRAWN'), money(d.withdrawn))}
            ${kpi(t('EXPENSES.SALARIES.PCT_OWED'), money(d.owed))}
            ${kpi(t('EXPENSES.SALARIES.PCT_UNPAID_TOTAL'), money(d.unpaidTotal),
                  t('EXPENSES.SALARIES.PCT_UNPAID_SHARE_NOTE', { share: money(d.unpaidShare) }))}
          </div>

          ${section(
            t('EXPENSES.SALARIES.PCT_BY_COURSE'),
            th([[t('EXPENSES.SALARIES.PCT_COL_COURSE'), false], [t('EXPENSES.SALARIES.PCT_COL_STUDENTS'), true],
                [t('EXPENSES.SALARIES.PCT_COL_PAYMENTS'), true], [t('EXPENSES.SALARIES.PCT_COL_REVENUE'), true],
                [t('EXPENSES.SALARIES.PCT_COL_SHARE'), true]]),
            courseRows,
            t('EXPENSES.SALARIES.PCT_NO_PAYMENTS'),
            `<tfoot><tr><td>${esc(t('EXPENSES.SALARIES.PCT_TOTAL'))}</td><td class="num">${this.studentCount()}</td>
              <td class="num">${this.lines().length}</td><td class="num">${money(d.totalPaid)}</td>
              <td class="num">${money(d.accrued)}</td></tr></tfoot>`
          )}

          ${section(
            t('EXPENSES.SALARIES.PCT_UNPAID_TITLE', { count: this.unpaid().length }),
            th([[t('EXPENSES.SALARIES.PCT_COL_STUDENT'), false], [t('EXPENSES.SALARIES.PCT_COL_CLASS'), false],
                [t('EXPENSES.SALARIES.PCT_COL_SOURCE'), false], [t('EXPENSES.SALARIES.PCT_COL_ATTENDED'), true],
                [t('EXPENSES.SALARIES.PCT_COL_LAST_ATTENDED'), false], [t('EXPENSES.SALARIES.PCT_COL_OUTSTANDING'), true],
                [t('EXPENSES.SALARIES.PCT_COL_POTENTIAL_SHARE'), true]]),
            unpaidRows,
            t('EXPENSES.SALARIES.PCT_NO_UNPAID'),
            `<tfoot><tr><td colspan="5">${esc(t('EXPENSES.SALARIES.PCT_TOTAL'))}</td>
              <td class="num">${money(d.unpaidTotal)}</td><td class="num">${money(d.unpaidShare)}</td></tr></tfoot>`
          )}

          ${section(
            t('EXPENSES.SALARIES.PCT_DETAILS', { count: this.lines().length }),
            th([[t('EXPENSES.SALARIES.PCT_COL_STUDENT'), false], [t('EXPENSES.SALARIES.PCT_COL_CLASS'), false],
                [t('EXPENSES.SALARIES.PCT_COL_SOURCE'), false], [t('EXPENSES.SALARIES.PCT_COL_DATE'), false],
                [t('EXPENSES.SALARIES.PCT_COL_PAID'), true], [t('EXPENSES.SALARIES.PCT_COL_SHARE'), true]]),
            paidRows,
            t('EXPENSES.SALARIES.PCT_NO_PAYMENTS')
          )}`;

    openPrintWindow({ title: `${this.employeeName()} — ${t('EXPENSES.SALARIES.PCT_TITLE')}`, rtl, body });
  }

  /** Colour the source chip so the three payment models are tellable apart. */
  sourceSeverity(source: string): 'success' | 'info' | 'warn' | 'secondary' {
    switch (source) {
      case 'MONTHLY': return 'info';
      case 'PACKAGE': return 'success';
      case 'SESSION': return 'warn';
      default: return 'secondary';
    }
  }
}
