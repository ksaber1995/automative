import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SessionService, Session } from '../services/session.service';
import { AttendanceService, SessionAttendanceStudent } from '../services/attendance.service';
import { BranchService } from '../../branches/services/branch.service';
import { CourseService } from '../../courses/services/course.service';
import { ClassService } from '../../courses/services/class.service';
import { StudentService } from '../../students/services/student.service';
import { AuthService } from '../../../core/services/auth.service';
import { Branch } from '@shared/interfaces/branch.interface';
import { Class } from '@shared/interfaces/class.interface';
import { Student } from '@shared/interfaces/student.interface';

/**
 * Standalone "Session History" page (moved out of the Sessions dashboard tab).
 * Lists ended/active sessions with server-side filters: branch, course, class,
 * and student. The Room column and Branch filter are hidden for TEACHER-type
 * companies (which have no rooms/branches concept in the UI).
 */
@Component({
  selector: 'app-session-history',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, TagModule, TableModule, SelectModule, TranslateModule],
  templateUrl: './session-history.component.html',
})
export class SessionHistoryComponent implements OnInit {
  private sessionService = inject(SessionService);
  private attendanceService = inject(AttendanceService);
  private branchService = inject(BranchService);
  private courseService = inject(CourseService);
  private classService = inject(ClassService);
  private studentService = inject(StudentService);
  private authService = inject(AuthService);
  private translate = inject(TranslateService);

  /** Teacher-type companies have no rooms/branches — hide those UI bits. */
  isTeacher = (): boolean => this.authService.isTeacher();

  loading = signal(false);
  sessions = signal<Session[]>([]);

  branches = signal<Branch[]>([]);
  courses = signal<{ id: string; name: string }[]>([]);
  classes = signal<Class[]>([]);
  studentOptions = signal<{ id: string; name: string }[]>([]);

  selectedBranchId = signal<string | null>(null);
  selectedCourseId = signal<string | null>(null);
  selectedClassId = signal<string | null>(null);
  selectedStudentId = signal<string | null>(null);
  /** Present/Absent filter — only meaningful when a student is selected. */
  selectedAttendance = signal<'ALL' | 'PRESENT' | 'ABSENT'>('ALL');
  attendanceOptions: { label: string; value: 'ALL' | 'PRESENT' | 'ABSENT' }[] = [];

  /** Classes narrowed to the chosen course (cascading class dropdown). */
  filteredClasses = computed<Class[]>(() => {
    const courseId = this.selectedCourseId();
    const all = this.classes();
    return courseId ? all.filter((c) => c.courseId === courseId) : all;
  });

  /** Whether the per-student attendance column is shown. */
  showAttendanceCol = computed<boolean>(() => !!this.selectedStudentId());

  /** Present/absent counts per session id (server-computed via class summaries). */
  attCounts = signal<Map<string, { present: number; absent: number; total: number }>>(new Map());
  /** Lazily-loaded present/absent student lists per session id (loaded on expand). */
  attDetail = signal<Map<string, { loading: boolean; present: SessionAttendanceStudent[]; absent: SessionAttendanceStudent[] }>>(new Map());

  counts(sessionId: string) {
    return this.attCounts().get(sessionId) ?? null;
  }
  detail(sessionId: string) {
    return this.attDetail().get(sessionId) ?? null;
  }

  /** Column count for the empty-state row: expander (1) + class/course/started/ended/duration (5)
   *  + present-absent (1) + room + per-student attendance. */
  historyColspan = computed<number>(() => 1 + 5 + 1 + (this.isTeacher() ? 0 : 1) + (this.showAttendanceCol() ? 1 : 0));

  hasFilters = computed<boolean>(
    () =>
      !!(this.selectedBranchId() || this.selectedCourseId() || this.selectedClassId() || this.selectedStudentId()) ||
      this.selectedAttendance() !== 'ALL',
  );

  ngOnInit(): void {
    this.attendanceOptions = [
      { label: this.translate.instant('SESSION_HISTORY.ATT_ALL'), value: 'ALL' },
      { label: this.translate.instant('SESSION_HISTORY.ATT_PRESENT'), value: 'PRESENT' },
      { label: this.translate.instant('SESSION_HISTORY.ATT_ABSENT'), value: 'ABSENT' },
    ];
    if (!this.isTeacher()) {
      this.branchService.getAllBranches().subscribe({ next: (b) => this.branches.set(b), error: () => {} });
    }
    this.courseService.getAllCourses().subscribe({
      next: (c) => this.courses.set(c.map((x) => ({ id: x.id, name: x.name }))),
      error: () => {},
    });
    this.classService.getAllClasses().subscribe({ next: (c) => this.classes.set(c), error: () => {} });
    this.studentService.getAllStudents().subscribe({
      next: (s) => this.studentOptions.set(s.map((x) => ({ id: x.id, name: `${x.firstName} ${x.lastName}` }))),
      error: () => {},
    });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    const filters: { branchId?: string; courseId?: string; classId?: string; studentId?: string; attendance?: string } = {};
    if (this.selectedBranchId()) filters.branchId = this.selectedBranchId()!;
    if (this.selectedCourseId()) filters.courseId = this.selectedCourseId()!;
    if (this.selectedClassId()) filters.classId = this.selectedClassId()!;
    if (this.selectedStudentId()) filters.studentId = this.selectedStudentId()!;
    // Present/Absent only applies per-student.
    if (this.selectedStudentId() && this.selectedAttendance() !== 'ALL') {
      filters.attendance = this.selectedAttendance();
    }
    this.sessionService.list(filters).subscribe({
      next: (s) => {
        this.sessions.set(s);
        this.loading.set(false);
        this.attDetail.set(new Map());
        this.loadAttendanceCounts(s);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Fetch present/absent counts for every listed session, one request per distinct
   *  class (class summaries already carry per-session present/absent counts). */
  private loadAttendanceCounts(sessions: Session[]): void {
    this.attCounts.set(new Map());
    const classIds = Array.from(new Set(sessions.map((s) => s.classId).filter(Boolean)));
    for (const classId of classIds) {
      this.attendanceService.getByClass(classId).subscribe({
        next: (summaries) => {
          this.attCounts.update((m) => {
            const next = new Map(m);
            for (const su of summaries) {
              next.set(su.sessionId, { present: su.presentCount, absent: su.absentCount, total: su.totalStudents });
            }
            return next;
          });
        },
        error: () => {},
      });
    }
  }

  /** PrimeNG row-expand hook: lazily load the present/absent student names. */
  onRowExpand(event: { data: Session }): void {
    const id = event.data.id;
    if (this.attDetail().get(id)) return; // already loaded / loading
    this.attDetail.update((m) => new Map(m).set(id, { loading: true, present: [], absent: [] }));
    this.attendanceService.getBySession(id).subscribe({
      next: (rows) => {
        const present = rows.filter((r) => r.isPresent);
        const absent = rows.filter((r) => !r.isPresent);
        this.attDetail.update((m) => new Map(m).set(id, { loading: false, present, absent }));
      },
      error: () => this.attDetail.update((m) => new Map(m).set(id, { loading: false, present: [], absent: [] })),
    });
  }

  onBranchChange(branchId: string | null): void {
    this.selectedBranchId.set(branchId);
    this.load();
  }

  onCourseChange(courseId: string | null): void {
    this.selectedCourseId.set(courseId);
    // Drop a selected class that no longer belongs to the chosen course.
    const cls = this.selectedClassId();
    if (cls && courseId && !this.classes().some((c) => c.id === cls && c.courseId === courseId)) {
      this.selectedClassId.set(null);
    }
    this.load();
  }

  onClassChange(classId: string | null): void {
    this.selectedClassId.set(classId);
    this.load();
  }

  onStudentChange(studentId: string | null): void {
    this.selectedStudentId.set(studentId);
    // Present/Absent only makes sense with a student — reset it when cleared.
    if (!studentId) this.selectedAttendance.set('ALL');
    this.load();
  }

  onAttendanceChange(value: 'ALL' | 'PRESENT' | 'ABSENT'): void {
    this.selectedAttendance.set(value ?? 'ALL');
    this.load();
  }

  clearFilters(): void {
    this.selectedBranchId.set(null);
    this.selectedCourseId.set(null);
    this.selectedClassId.set(null);
    this.selectedStudentId.set(null);
    this.selectedAttendance.set('ALL');
    this.load();
  }

  formatDateTime(dateStr: string): string {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  getDuration(startStr: string): string {
    const mins = Math.floor((Date.now() - new Date(startStr).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  formatDuration(mins: number): string {
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
}
