import { Component, OnInit, OnDestroy, inject, input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SessionService, Session } from '../services/session.service';
import { AttendanceService, SessionAttendanceStudent } from '../services/attendance.service';
import { CourseService } from '../../courses/services/course.service';
import { ClassService } from '../../courses/services/class.service';
import { StudentService } from '../../students/services/student.service';
import { AuthService } from '../../../core/services/auth.service';
import { GlobalScanService } from '../../../core/services/global-scan.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { Class } from '@shared/interfaces/class.interface';

/**
 * Session history: ended/active sessions with server-side filters (branch, course,
 * class, student). The Room column and Branch filter are hidden for TEACHER-type
 * companies (which have no rooms/branches concept in the UI).
 *
 * Lives as the History tab of the Sessions page (`embedded`), and stays reachable
 * on its own /session-history route, which is what the standalone header is for.
 */
@Component({
  selector: 'app-session-history',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, TagModule, TableModule, SelectModule, ConfirmDialogModule, TooltipModule, TranslateModule],
  templateUrl: './session-history.component.html',
  // Own instance so the delete confirmation targets THIS component's dialog and
  // not the Sessions page's, which hosts us as its History tab.
  providers: [ConfirmationService],
})
export class SessionHistoryComponent implements OnInit, OnDestroy {
  /** True when hosted inside the Sessions page's History tab (see the template). */
  embedded = input<boolean>(false);

  private sessionService = inject(SessionService);
  private attendanceService = inject(AttendanceService);
  private lookupService = inject(LookupService);
  private courseService = inject(CourseService);
  private classService = inject(ClassService);
  private studentService = inject(StudentService);
  private authService = inject(AuthService);
  private translate = inject(TranslateService);
  private globalScan = inject(GlobalScanService);
  private notify = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  // Stable reference so the app-wide scan handler can be unregistered on destroy.
  private readonly scanHandler = (token: string) => this.onScan(token);

  /** Teacher-type companies have no rooms/branches — hide those UI bits. */
  isTeacher = (): boolean => this.authService.isTeacher();

  loading = signal(false);
  sessions = signal<Session[]>([]);

  branches = signal<LookupOption[]>([]);
  courses = signal<{ id: string; name: string }[]>([]);
  classes = signal<Class[]>([]);
  studentOptions = signal<LookupOption[]>([]);

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
   *  + present-absent (1) + actions (1) + room + per-student attendance. */
  historyColspan = computed<number>(() => 1 + 5 + 1 + 1 + (this.isTeacher() ? 0 : 1) + (this.showAttendanceCol() ? 1 : 0));

  /** Session currently being deleted — disables its row's button. */
  deletingId = signal<string | null>(null);

  hasFilters = computed<boolean>(
    () =>
      !!(this.selectedBranchId() || this.selectedCourseId() || this.selectedClassId() || this.selectedStudentId()) ||
      this.selectedAttendance() !== 'ALL',
  );

  // ── Matrix (Excel-style) view ───────────────────────────────────────────────
  /** Toggle between the chronological list and the student × session grid. */
  matrixView = signal(false);
  matrixLoading = signal(false);
  /** Sessions for the selected class, ordered by session number — the grid columns. */
  matrixSessions = signal<Session[]>([]);
  /** Distinct students across those sessions — the grid rows. */
  matrixStudents = signal<{ studentId: string; name: string }[]>([]);
  /** Present/absent per cell, keyed `${studentId}|${sessionId}`. */
  matrixAtt = signal<Map<string, boolean>>(new Map());
  /** When a QR is scanned, narrow the grid to that single student. */
  scanFilterStudentId = signal<string | null>(null);
  scanFilterName = signal<string>('');

  /** Grid rows after applying the scan filter. */
  matrixFilteredStudents = computed<{ studentId: string; name: string }[]>(() => {
    const id = this.scanFilterStudentId();
    const list = this.matrixStudents();
    return id ? list.filter((s) => s.studentId === id) : list;
  });

  /** Cell value: true = present, false = absent, null = not enrolled/no record. */
  cellState(studentId: string, sessionId: string): boolean | null {
    const v = this.matrixAtt().get(`${studentId}|${sessionId}`);
    return v === undefined ? null : v;
  }

  ngOnInit(): void {
    this.attendanceOptions = [
      { label: this.translate.instant('SESSION_HISTORY.ATT_ALL'), value: 'ALL' },
      { label: this.translate.instant('SESSION_HISTORY.ATT_PRESENT'), value: 'PRESENT' },
      { label: this.translate.instant('SESSION_HISTORY.ATT_ABSENT'), value: 'ABSENT' },
    ];
    if (!this.isTeacher()) {
      this.lookupService.branches().subscribe({ next: (b) => this.branches.set(b), error: () => {} });
    }
    this.courseService.getAllCourses().subscribe({
      next: (c) => this.courses.set(c.map((x) => ({ id: x.id, name: x.name }))),
      error: () => {},
    });
    this.classService.getAllClasses().subscribe({ next: (c) => this.classes.set(c), error: () => {} });
    this.lookupService.students().subscribe({
      next: (s) => this.studentOptions.set(s),
      error: () => {},
    });
    this.load();

    // Take over the app-wide scanner while this page is open: a scan filters the
    // grid down to the scanned student (and switches into grid view).
    this.globalScan.register(this.scanHandler);
  }

  ngOnDestroy(): void {
    this.globalScan.unregister(this.scanHandler);
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
    if (this.matrixView()) this.loadMatrix();
  }

  onClassChange(classId: string | null): void {
    this.selectedClassId.set(classId);
    this.load();
    if (this.matrixView()) this.loadMatrix();
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
    this.clearScanFilter();
    this.load();
    if (this.matrixView()) this.loadMatrix();
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  /**
   * Deleting a session erases its attendance with it and cannot be undone, so
   * the confirmation names the exact session (class + date) and says what is
   * lost. The server refuses if money was collected on it.
   */
  confirmDelete(session: Session): void {
    const c = this.counts(session.id);
    this.confirmationService.confirm({
      header: this.translate.instant('SESSION_HISTORY.DELETE_TITLE'),
      message: this.translate.instant('SESSION_HISTORY.DELETE_MSG', {
        session: session.className ?? '',
        date: this.formatDateTime(session.startDate),
        present: c?.present ?? 0,
      }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('SESSION_HISTORY.DELETE_ACCEPT'),
      rejectLabel: this.translate.instant('SESSION_HISTORY.DELETE_REJECT'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.deleteSession(session),
    });
  }

  private deleteSession(session: Session): void {
    this.deletingId.set(session.id);
    this.sessionService.remove(session.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.notify.success(this.translate.instant('SESSION_HISTORY.MSG_DELETED'));
        this.load();
        if (this.matrixView()) this.loadMatrix();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.deletingId.set(null);
      },
    });
  }

  // ── Matrix view ─────────────────────────────────────────────────────────────

  /** Flip between the list and the student × session grid. */
  toggleView(): void {
    const next = !this.matrixView();
    this.matrixView.set(next);
    if (next) this.loadMatrix();
  }

  /** Build the grid for the selected class: sessions as columns, students as rows. */
  loadMatrix(): void {
    const classId = this.selectedClassId();
    this.matrixSessions.set([]);
    this.matrixStudents.set([]);
    this.matrixAtt.set(new Map());
    if (!classId) return;

    this.matrixLoading.set(true);
    this.sessionService.list({ classId }).subscribe({
      next: (sessions) => {
        const sorted = [...sessions].sort(
          (a, b) =>
            (a.sessionNumber ?? Number.MAX_SAFE_INTEGER) - (b.sessionNumber ?? Number.MAX_SAFE_INTEGER) ||
            new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
        );
        this.matrixSessions.set(sorted);
        if (sorted.length === 0) {
          this.matrixLoading.set(false);
          return;
        }

        // Pull each session's roster (with present/absent) and fold into the grid.
        const studentMap = new Map<string, string>();
        const att = new Map<string, boolean>();
        let remaining = sorted.length;
        const done = () => {
          if (--remaining > 0) return;
          const students = Array.from(studentMap, ([studentId, name]) => ({ studentId, name })).sort((a, b) =>
            a.name.localeCompare(b.name),
          );
          this.matrixStudents.set(students);
          this.matrixAtt.set(att);
          this.matrixLoading.set(false);
        };
        for (const sess of sorted) {
          this.attendanceService.getBySession(sess.id).subscribe({
            next: (rows) => {
              for (const r of rows) {
                if (!studentMap.has(r.studentId)) studentMap.set(r.studentId, `${r.studentName}`);
                att.set(`${r.studentId}|${sess.id}`, r.isPresent);
              }
            },
            error: () => {},
            complete: done,
          });
        }
      },
      error: () => this.matrixLoading.set(false),
    });
  }

  /** App-wide scan handler: resolve the QR to a student and filter the grid to them. */
  private onScan(token: string): void {
    this.studentService.lookupByQr(token).subscribe({
      next: (res) => {
        this.scanFilterStudentId.set(res.id);
        const opt = this.studentOptions().find((o) => o.id === res.id);
        this.scanFilterName.set(opt?.label ?? '');
        // A scan is only meaningful in the grid — switch to it if needed.
        if (!this.matrixView()) {
          this.matrixView.set(true);
          this.loadMatrix();
        }
      },
      error: () => this.notify.error(this.translate.instant('NAV.QR_STUDENT_NOT_FOUND')),
    });
  }

  clearScanFilter(): void {
    this.scanFilterStudentId.set(null);
    this.scanFilterName.set('');
  }

  formatDateShort(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
