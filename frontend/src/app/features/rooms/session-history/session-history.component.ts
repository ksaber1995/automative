import { Component, OnInit, OnDestroy, ViewChild, inject, input, signal, computed } from '@angular/core';
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
import { SessionPayDialogComponent } from '../../session-payments/session-pay-dialog/session-pay-dialog.component';
import { Class } from '@shared/interfaces/class.interface';

/**
 * Session history: ended/active sessions with server-side filters (branch, course,
 * class, student). The Room column and Branch filter are hidden for TEACHER-type
 * companies (which have no rooms/branches concept in the UI).
 *
 * Lives as the History tab of the Sessions page (`embedded`), and stays reachable
 * on its own /session-history route, which is what the standalone header is for.
 *
 * Attendance is editable here after the fact — see `toggleAttendance`. A roster is
 * routinely wrong once the lesson is over (a card scanned twice, a student who
 * turned up and was never marked), and this is the screen people look at when they
 * notice.
 */
@Component({
  selector: 'app-session-history',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, TagModule, TableModule, SelectModule, ConfirmDialogModule, TooltipModule, TranslateModule, SessionPayDialogComponent],
  templateUrl: './session-history.component.html',
  // Own instance so the delete confirmation targets THIS component's dialog and
  // not the Sessions page's, which hosts us as its History tab.
  providers: [ConfirmationService],
})
export class SessionHistoryComponent implements OnInit, OnDestroy {
  /** True when hosted inside the Sessions page's History tab (see the template). */
  embedded = input<boolean>(false);

  /** PER_SESSION courses: collects a fee raised by marking someone present. */
  @ViewChild(SessionPayDialogComponent) payDialog?: SessionPayDialogComponent;

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
  attCounts = signal<Map<string, { present: number; absent: number; substituted: number; total: number }>>(new Map());
  /**
   * Lazily-loaded rosters per session id (loaded on expand). `substituted` are
   * enrolled students who were not in this room but sat the lesson with a
   * sibling class — they are not absentees and are listed apart from them.
   */
  attDetail = signal<Map<string, { loading: boolean; present: SessionAttendanceStudent[]; absent: SessionAttendanceStudent[]; substituted: SessionAttendanceStudent[] }>>(new Map());

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
  /** Cells the student missed here but sat with a sibling class — same keying. */
  matrixSub = signal<Set<string>>(new Set());
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

  /** An absent-looking cell that is really a make-up taken in another class. */
  cellSubstituted(studentId: string, sessionId: string): boolean {
    return this.matrixSub().has(`${studentId}|${sessionId}`);
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
              next.set(su.sessionId, {
                present: su.presentCount,
                absent: su.absentCount,
                substituted: su.substitutedCount ?? 0,
                total: su.totalStudents,
              });
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
    this.attDetail.update((m) => new Map(m).set(id, { loading: true, present: [], absent: [], substituted: [] }));
    this.attendanceService.getBySession(id).subscribe({
      next: (rows) => {
        const present = rows.filter((r) => r.isPresent);
        // Missing from the room but not from the lesson — kept out of the
        // absent list, which is the whole point of recording a make-up.
        const substituted = rows.filter((r) => !r.isPresent && !!r.substitutedInClassName);
        const absent = rows.filter((r) => !r.isPresent && !r.substitutedInClassName);
        this.attDetail.update((m) => new Map(m).set(id, { loading: false, present, absent, substituted }));
      },
      error: () =>
        this.attDetail.update((m) => new Map(m).set(id, { loading: false, present: [], absent: [], substituted: [] })),
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

  // ── Edit attendance ─────────────────────────────────────────────────────────
  //
  // Both views correct a finished session's roster, through one path. Marking
  // present goes through the bulk save, because that is what raises a PER_SESSION
  // fee (handed straight to the pay dialog). Un-marking deletes the single
  // attendance row instead of re-saving the list: the row may be a SUBSTITUTION or
  // TRIAL scan, which the bulk save deliberately doesn't manage, and the delete
  // reverses whatever fee that attendance raised. Un-marking someone who already
  // has a charge asks first — their payment goes with it.

  /** Read-only users see the roster but no toggles (the API would 403 anyway). */
  canEdit = (): boolean => this.authService.canWrite('academy');

  /** `${sessionId}|${studentId}` for every toggle in flight, so it can't double-fire. */
  private busy = signal<Set<string>>(new Set());

  isBusy(sessionId: string, studentId: string): boolean {
    return this.busy().has(`${sessionId}|${studentId}`);
  }

  private setBusy(key: string, on: boolean): void {
    this.busy.update((s) => {
      const next = new Set(s);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  }

  /**
   * The session's roster. The expanded row already loaded it; the grid never does
   * (it only keeps a present/absent bitmap), so fetch it there — the toggle needs
   * the student's charge and enrolment to decide what it's allowed to do.
   */
  private withRoster(sessionId: string, run: (roster: SessionAttendanceStudent[]) => void): void {
    const cached = this.attDetail().get(sessionId);
    if (cached && !cached.loading) {
      run([...cached.present, ...cached.absent, ...cached.substituted]);
      return;
    }
    this.attendanceService.getBySession(sessionId).subscribe({
      next: (rows) => {
        this.attDetail.update((m) =>
          new Map(m).set(sessionId, {
            loading: false,
            present: rows.filter((r) => r.isPresent),
            absent: rows.filter((r) => !r.isPresent && !r.substitutedInClassName),
            substituted: rows.filter((r) => !r.isPresent && !!r.substitutedInClassName),
          }),
        );
        run(rows);
      },
      error: () => {},
    });
  }

  /** Mark one student present, or un-mark them, on an already-finished session. */
  toggleAttendance(sessionId: string, studentId: string, present: boolean): void {
    if (!this.canEdit() || this.isBusy(sessionId, studentId)) return;
    this.withRoster(sessionId, (roster) => {
      const student = roster.find((r) => r.studentId === studentId);
      if (!student) return;
      if (!present && student.charge) {
        this.confirmChargeThen(student, () => this.applyToggle(sessionId, roster, student, false));
        return;
      }
      this.applyToggle(sessionId, roster, student, present);
    });
  }

  /**
   * Un-checking a student with a per-session charge deletes that charge, and any
   * payment already taken against it. Name the amount before doing it.
   */
  private confirmChargeThen(student: SessionAttendanceStudent, onAccept: () => void): void {
    const c = student.charge;
    if (!c) { onAccept(); return; }
    const detail = c.amountPaid > 0
      ? this.translate.instant('SESSION_ATTENDANCE.UNCHECK_PAID', { amount: c.amountPaid })
      : this.translate.instant('SESSION_ATTENDANCE.UNCHECK_UNPAID', { amount: c.amountDue });
    this.confirmationService.confirm({
      header: this.translate.instant('SESSION_ATTENDANCE.UNCHECK_TITLE'),
      message: this.translate.instant('SESSION_ATTENDANCE.UNCHECK_MSG', { name: `${student.studentName}`.trim() }) + ' ' + detail,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('SESSION_ATTENDANCE.UNCHECK_ACCEPT'),
      rejectLabel: this.translate.instant('SESSION_ATTENDANCE.UNCHECK_CANCEL'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: onAccept,
    });
  }

  private applyToggle(
    sessionId: string,
    roster: SessionAttendanceStudent[],
    student: SessionAttendanceStudent,
    present: boolean,
  ): void {
    const key = `${sessionId}|${student.studentId}`;
    this.setBusy(key, true);

    if (present) {
      // The bulk save owns the whole present list, and reverses the fee of anyone
      // left out of it — so send everyone still present, off-roster attendees
      // included, plus this student. The server keeps each existing row's type.
      const presentIds = roster.filter((r) => r.isPresent).map((r) => r.studentId);
      presentIds.push(student.studentId);
      this.attendanceService.saveForSession(sessionId, presentIds).subscribe({
        next: (res) => {
          this.setBusy(key, false);
          this.afterToggle(sessionId, student, true);
          if (res.sessionCharges?.length) this.payDialog?.enqueue(res.sessionCharges);
        },
        // Interceptor toasted the translated error.
        error: () => this.setBusy(key, false),
      });
    } else {
      this.attendanceService.removeAttendee(sessionId, student.studentId).subscribe({
        next: () => {
          this.setBusy(key, false);
          this.afterToggle(sessionId, student, false);
        },
        error: () => this.setBusy(key, false),
      });
    }
  }

  /**
   * Fold the change into what's on screen instead of reloading: the expanded row's
   * two lists, the Present/Absent column, and the grid cell — so the list and grid
   * views never disagree about a session someone just edited.
   */
  private afterToggle(sessionId: string, student: SessionAttendanceStudent, present: boolean): void {
    // A substitution/trial attendee has no enrolment to be "absent" from, so
    // un-marking drops them off the roster entirely rather than moving them.
    const dropped = !present && student.isEnrolled === false;

    this.attDetail.update((m) => {
      const d = m.get(sessionId);
      if (!d) return m;
      const all = [...d.present, ...d.absent, ...d.substituted]
        .filter((s) => !(dropped && s.studentId === student.studentId))
        .map((s) =>
          s.studentId === student.studentId
            ? { ...s, isPresent: present, charge: present ? s.charge : null }
            : s,
        );
      return new Map(m).set(sessionId, {
        loading: false,
        present: all.filter((s) => s.isPresent),
        absent: all.filter((s) => !s.isPresent && !s.substitutedInClassName),
        substituted: all.filter((s) => !s.isPresent && !!s.substitutedInClassName),
      });
    });

    this.attCounts.update((m) => {
      const c = m.get(sessionId);
      if (!c) return m;
      // A student who made the lesson up comes out of the substituted tally, not
      // the absent one — they were never in it.
      const madeUp = !!student.substitutedInClassName;
      const next = present
        ? madeUp
          ? { ...c, present: c.present + 1, substituted: Math.max(0, c.substituted - 1) }
          : { ...c, present: c.present + 1, absent: Math.max(0, c.absent - 1) }
        : dropped
          ? { ...c, present: Math.max(0, c.present - 1) }
          : madeUp
            ? { ...c, present: Math.max(0, c.present - 1), substituted: c.substituted + 1 }
            : { ...c, present: Math.max(0, c.present - 1), absent: c.absent + 1 };
      return new Map(m).set(sessionId, next);
    });

    this.matrixAtt.update((m) => {
      const cellKey = `${student.studentId}|${sessionId}`;
      if (!m.has(cellKey)) return m;
      const next = new Map(m);
      if (dropped) next.delete(cellKey); else next.set(cellKey, present);
      return next;
    });

    this.notify.success(this.translate.instant('SESSION_HISTORY.MSG_ATT_UPDATED'));
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
    this.matrixSub.set(new Set());
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
        const subs = new Set<string>();
        let remaining = sorted.length;
        const done = () => {
          if (--remaining > 0) return;
          const students = Array.from(studentMap, ([studentId, name]) => ({ studentId, name })).sort((a, b) =>
            a.name.localeCompare(b.name),
          );
          this.matrixStudents.set(students);
          this.matrixAtt.set(att);
          this.matrixSub.set(subs);
          this.matrixLoading.set(false);
        };
        for (const sess of sorted) {
          this.attendanceService.getBySession(sess.id).subscribe({
            next: (rows) => {
              for (const r of rows) {
                if (!studentMap.has(r.studentId)) studentMap.set(r.studentId, `${r.studentName}`);
                att.set(`${r.studentId}|${sess.id}`, r.isPresent);
                if (!r.isPresent && r.substitutedInClassName) subs.add(`${r.studentId}|${sess.id}`);
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
