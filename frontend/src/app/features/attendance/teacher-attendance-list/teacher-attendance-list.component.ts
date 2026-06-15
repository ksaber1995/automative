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
import { BranchService } from '../../branches/services/branch.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { Branch } from '@shared/interfaces/branch.interface';

interface TeacherOption {
  id: string;
  displayName: string;
}

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
  private branchService = inject(BranchService);
  private employeeService = inject(EmployeeService);
  protected branchState = inject(BranchStateService);

  rows = signal<TeacherAttendanceHistoryRow[]>([]);
  branches = signal<Branch[]>([]);
  teachers = signal<TeacherOption[]>([]);
  loading = signal(false);

  selectedBranchId: string | null = null;
  selectedEmployeeId: string | null = null;
  startDate: string = '';
  endDate: string = '';

  presentCount = computed(() => this.rows().filter((r) => r.status === 'PRESENT').length);
  absentCount = computed(() => this.rows().filter((r) => r.status === 'ABSENT').length);

  hasActiveFilters = computed(() =>
    !!this.selectedBranchId || !!this.selectedEmployeeId || !!this.startDate || !!this.endDate,
  );

  ngOnInit() {
    this.branchService.getAllBranches().subscribe({
      next: (b) => this.branches.set(b),
    });
    this.employeeService.getAllEmployees().subscribe({
      next: (employees) => {
        const list = employees.map((e: any) => ({
          id: e.id,
          displayName: `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email || 'Unnamed',
        }));
        this.teachers.set(list);
      },
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
    this.startDate = '';
    this.endDate = '';
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
