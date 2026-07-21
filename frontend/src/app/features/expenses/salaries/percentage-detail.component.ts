import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { ExpenseService, PercentageBreakdown } from '../services/expense.service';
import { EmployeeService } from '../../employees/services/employee.service';

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
  imports: [CommonModule, RouterLink, TranslateModule, CardModule, TableModule, TagModule, AmountPipe],
  templateUrl: './percentage-detail.component.html',
})
export class PercentageDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private expenseService = inject(ExpenseService);
  private employeeService = inject(EmployeeService);

  loading = signal(true);
  notFound = signal(false);
  employeeName = signal('');
  data = signal<PercentageBreakdown | null>(null);

  lines = computed(() => this.data()?.lines ?? []);

  studentCount = computed(() => new Set(this.lines().map((l) => l.studentName)).size);

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
