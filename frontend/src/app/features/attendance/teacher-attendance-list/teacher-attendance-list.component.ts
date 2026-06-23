import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { TranslateModule } from '@ngx-translate/core';
import { TeacherAttendanceService, TeacherAttendanceHistoryRow } from '../services/teacher-attendance.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { BranchStateService } from '../../../core/services/branch-state.service';

@Component({
  selector: 'app-teacher-attendance-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    TagModule,
    SelectModule,
    ButtonModule,
    TranslateModule,
  ],
  templateUrl: './teacher-attendance-list.component.html',
})
export class TeacherAttendanceListComponent implements OnInit {
  private attendanceService = inject(TeacherAttendanceService);
  private lookupService = inject(LookupService);
  protected branchState = inject(BranchStateService);

  rows = signal<TeacherAttendanceHistoryRow[]>([]);
  branches = signal<LookupOption[]>([]);
  teachers = signal<LookupOption[]>([]);
  loading = signal(false);

  selectedBranchId: string | null = null;
  selectedEmployeeId: string | null = null;
  // Default to the current calendar month; the user can widen/change the range.
  startDate: string = this.monthStartIso();
  endDate: string = this.monthEndIso();

  private static iso(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
  private monthStartIso(): string {
    const n = new Date();
    return TeacherAttendanceListComponent.iso(new Date(n.getFullYear(), n.getMonth(), 1));
  }
  private monthEndIso(): string {
    const n = new Date();
    return TeacherAttendanceListComponent.iso(new Date(n.getFullYear(), n.getMonth() + 1, 0));
  }

  presentCount = computed(() => this.rows().filter((r) => r.status === 'PRESENT').length);
  absentCount = computed(() => this.rows().filter((r) => r.status === 'ABSENT').length);

  hasActiveFilters = computed(() =>
    !!this.selectedBranchId || !!this.selectedEmployeeId || !!this.startDate || !!this.endDate,
  );

  ngOnInit() {
    this.lookupService.branches().subscribe({
      next: (b) => this.branches.set(b),
    });
    this.lookupService.employees().subscribe({
      next: (employees) => this.teachers.set(employees),
    });
    this.load();
  }

  load() {
    this.loading.set(true);
    const filters: any = {};
    if (this.selectedBranchId) filters.branchId = this.selectedBranchId;
    if (this.selectedEmployeeId) filters.employeeId = this.selectedEmployeeId;
    if (this.startDate) filters.startDate = this.startDate;
    if (this.endDate) filters.endDate = this.endDate;

    this.attendanceService.getHistory(filters).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false);
      },
    });
  }

  clearFilters() {
    this.selectedBranchId = null;
    this.selectedEmployeeId = null;
    // Reset back to the default (current month) rather than all-time.
    this.startDate = this.monthStartIso();
    this.endDate = this.monthEndIso();
    this.load();
  }

  roleSeverity(role: string): 'success' | 'info' | 'warn' | 'secondary' {
    if (role === 'PRIMARY') return 'success';
    if (role === 'SUBSTITUTE') return 'warn';
    return 'info';
  }

  formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
}
