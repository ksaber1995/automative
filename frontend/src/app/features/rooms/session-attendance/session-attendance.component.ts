import { Component, OnInit, OnDestroy, inject, signal, computed, ViewChild } from '@angular/core';
import { formatStudentCode } from '../../../core/utils/student-code.util';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule, FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SessionService, Session } from '../services/session.service';
import { AttendanceService, SessionAttendanceStudent, AttendanceType, StudentSessionDues } from '../services/attendance.service';
import { StudentDuesBadgeComponent } from '../../../shared/components/student-dues/student-dues-badge.component';
import { StudentAbsenceBadgeComponent } from '../../../shared/components/student-dues/student-absence-badge.component';
import { DuesCollectDialogComponent } from '../../../shared/components/student-dues/dues-collect-dialog.component';
import { StudentService } from '../../students/services/student.service';
import { TeacherAttendanceService, SessionTeacherAttendanceRow } from '../../attendance/services/teacher-attendance.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { LanguageService } from '../../../core/services/language.service';
import { NotificationService } from '../../../core/services/notification.service';
import { GlobalScanService } from '../../../core/services/global-scan.service';
import { AuthService } from '../../../core/services/auth.service';
import { WhatsappTemplatesService } from '../../../core/services/whatsapp-templates.service';
import { openWhatsappChat, renderWhatsappTemplate } from '../../../core/utils/whatsapp.util';
import { toLocalYmd } from '../../../core/utils/date.util';
import { cameraScanConfig } from '../../../core/utils/scanner-formats.util';
import { SessionPayDialogComponent } from '../../session-payments/session-pay-dialog/session-pay-dialog.component';
import { SessionHomeworkPanelComponent } from '../session-homework/session-homework-panel.component';

interface TeacherRow {
  employeeId: string;
  role: 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT';
  status: 'PRESENT' | 'ABSENT';
}

interface TeacherOption {
  id: string;
  displayName: string;
}

/** Cross-field validator: endTime must not produce a datetime before startDate */
function endTimeAfterStartValidator(startDate: string) {
  return (control: AbstractControl): ValidationErrors | null => {
    const timeVal: string = control.value; // "HH:mm"
    if (!timeVal || !startDate) return null;
    const start = new Date(startDate);
    const [hours, minutes] = timeVal.split(':').map(Number);
    const end = new Date(start);
    end.setHours(hours, minutes, 0, 0);
    return end < start ? { endBeforeStart: true } : null;
  };
}

/**
 * Full-page attendance editor for a single session, opened in a new tab from the
 * sessions dashboard ("expand"). The inline accordion on the dashboard is cramped
 * for large classes (100+ students); this page gives the full screen plus a
 * search box and bulk mark-all so a long roster is manageable. Attendance
 * auto-saves (debounced) exactly like the inline editor.
 */
@Component({
  selector: 'app-session-attendance',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule, CardModule, ButtonModule, CheckboxModule, InputTextModule, SelectModule, DialogModule, ConfirmDialogModule, TextareaModule, TooltipModule, TranslateModule, StudentDuesBadgeComponent, StudentAbsenceBadgeComponent, DuesCollectDialogComponent, SessionPayDialogComponent, SessionHomeworkPanelComponent],
  providers: [ConfirmationService],
  templateUrl: './session-attendance.component.html',
})
export class SessionAttendanceComponent implements OnInit, OnDestroy {
  /** A card-derived code reads "A5", not 100005. */
  code = formatStudentCode;

  @ViewChild(SessionPayDialogComponent) payDialog?: SessionPayDialogComponent;
  @ViewChild(DuesCollectDialogComponent) collectDialog?: DuesCollectDialogComponent;
  @ViewChild(SessionHomeworkPanelComponent) homeworkPanel?: SessionHomeworkPanelComponent;

  /** Homework marking is open — scans record a mark instead of checking in. */
  homeworkOpen = signal(false);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private sessionService = inject(SessionService);
  private attendanceService = inject(AttendanceService);
  private studentService = inject(StudentService);
  private teacherAttendanceService = inject(TeacherAttendanceService);
  private employeeService = inject(EmployeeService);
  private confirmationService = inject(ConfirmationService);
  private languageService = inject(LanguageService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private templatesSvc = inject(WhatsappTemplatesService);
  private globalScan = inject(GlobalScanService);
  // Stable reference so the app-wide scan handler can be unregistered on destroy.
  // Only ONE global scan handler can be registered at a time, so this page keeps
  // it and forwards to the homework panel while that's open — otherwise the two
  // would overwrite each other's handler and a scan would go to the wrong place.
  private readonly scanHandler = (token: string) => {
    if (this.homeworkOpen()) this.homeworkPanel?.handleScan(token);
    else this.checkin(token);
  };

  sessionId = '';
  session = signal<Session | null>(null);
  students = signal<SessionAttendanceStudent[]>([]);
  loading = signal(true);
  search = signal('');
  saveState = signal<'saving' | 'saved' | 'error' | undefined>(undefined);

  // Check-in has no scanner panel: a USB/keyboard-wedge scan arrives through the
  // app-wide GlobalScanService handler, and the roster's search box resolves a
  // typed student code on Enter.
  resolvingCode = signal(false);
  lastScanResult = signal<{ name: string; alreadyPresent: boolean; attendanceType?: AttendanceType | null; homeClassName?: string | null } | null>(null);

  // Session number inline edit
  editingNumber = signal(false);
  numberDraft = signal<number | null>(null);
  savingNumber = signal(false);
  // Web Audio context for the check-in beep. Browsers block audio until a user
  // gesture, so it is primed from the roster interactions (there is no scanner
  // button to prime it any more).
  private audioCtx?: AudioContext;

  private saveTimer?: ReturnType<typeof setTimeout>;
  private savedClearTimer?: ReturnType<typeof setTimeout>;
  private readonly SAVE_DEBOUNCE_MS = 600;

  filteredStudents = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.students();
    if (!q) return list;
    return list.filter((s) => {
      const name = `${s.studentName}`.toLowerCase();
      const code = formatStudentCode(s.studentCode);
      return name.includes(q) || (code !== '' && code.includes(q));
    });
  });

  presentCount = computed(() => this.students().filter((s) => s.isPresent).length);
  absentCount = computed(() => this.students().filter((s) => !s.isPresent).length);

  /** A student absent this many of the class's recent sessions in a row is flagged.
   *  1 = flag any student who missed the previous session (don't wait for a streak). */
  readonly ABSENCE_WARN_THRESHOLD = 1;
  /** Enrolled students who have missed the last N sessions in a row. */
  atRiskStudents = computed(() =>
    this.students().filter((s) => (s.absentStreak ?? 0) >= this.ABSENCE_WARN_THRESHOLD),
  );
  /** First few flagged students named in the banner (the rest become "+N more"). */
  bannerStudents = computed(() => this.atRiskStudents().slice(0, 8));
  bannerMore = computed(() => Math.max(0, this.atRiskStudents().length - 8));
  isAtRisk = (s: SessionAttendanceStudent): boolean =>
    (s.absentStreak ?? 0) >= this.ABSENCE_WARN_THRESHOLD;
  /** Top banner shown briefly when the roster loads with at-risk students. */
  showAbsenceBanner = signal(false);
  private absenceBannerTimer?: ReturnType<typeof setTimeout>;

  // ── Money owed, per student ─────────────────────────────────────────────────
  // Attendance is the one moment the student is standing there, so the roster
  // says who is clear and who owes before they walk out. Loaded separately from
  // the roster: it is the slower query and the roster must not wait on it.
  duesByStudent = signal<Map<string, StudentSessionDues>>(new Map());
  duesPaymentType = signal<string>('');
  loadingDues = signal(false);

  /** Undefined for a student the endpoint can't speak for — the badge then
   *  renders nothing rather than an unverified green. */
  dues = (studentId: string): StudentSessionDues | undefined => this.duesByStudent().get(studentId);

  // ── Camera check-in (phones) ────────────────────────────────────────────────
  // Everything else on this page assumes a USB/keyboard-wedge reader: it types
  // the code and the app-wide handler catches it. A phone has no such reader, so
  // without this the only way to take attendance on one is tapping 40 checkboxes.
  private readonly SCANNER_ELEMENT_ID = 'session-attendance-qr-region';
  private html5Qr?: any;
  scannerOpen = signal(false);
  cameraStarting = signal(false);
  /** Suppress the rapid repeat decodes html5-qrcode fires for one physical scan. */
  private lastScan = '';
  private lastScanAt = 0;
  private readonly SCAN_DEDUP_MS = 2500;

  /**
   * Phone-sized viewport. Live, not read once: a tablet rotating into portrait
   * should gain the button without a reload. Desktops keep it hidden — they have
   * the wedge reader, and the navbar's QR dialog if they really do want a camera.
   */
  isMobile = signal(false);
  private mobileQuery?: MediaQueryList;
  private readonly onViewportChange = (e: MediaQueryListEvent | MediaQueryList) =>
    this.isMobile.set(e.matches);

  /** TEACHER-type company — used to hide staff/teacher management. */
  isTeacherCompany = computed(() => this.auth.isTeacher());

  /** True while the session is still running (no end date yet). */
  isActive = computed(() => !!this.session() && !this.session()!.endDate);

  /** True when the session is prepared but not formally started. */
  isPrepared = computed(() => !!this.session() && this.session()!.started === false);
  startingSession = signal(false);

  // ── Teacher management ──────────────────────────────────────────────────────
  teacherPanelOpen = signal(false);
  loadingTeachers = signal(false);
  savingTeachers = signal(false);
  teacherRows = signal<TeacherRow[]>([]);
  allEmployees = signal<TeacherOption[]>([]);
  newTeacherEmployeeId: string | null = null;

  availableEmployees = computed<TeacherOption[]>(() => {
    const used = new Set(this.teacherRows().map((t) => t.employeeId));
    return this.allEmployees().filter((e) => !used.has(e.id));
  });

  /** Role/status option labels — recompute when the active language changes. */
  roleOptions = computed<{ label: string; value: 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT' }[]>(() => {
    this.languageService.currentLang(); // dependency
    return [
      { label: this.translate.instant('SESSIONS_DASHBOARD.ROLE_PRIMARY'), value: 'PRIMARY' },
      { label: this.translate.instant('SESSIONS_DASHBOARD.ROLE_SUBSTITUTE'), value: 'SUBSTITUTE' },
      { label: this.translate.instant('SESSIONS_DASHBOARD.ROLE_ASSISTANT'), value: 'ASSISTANT' },
    ];
  });
  statusOptions = computed<{ label: string; value: 'PRESENT' | 'ABSENT' }[]>(() => {
    this.languageService.currentLang();
    return [
      { label: this.translate.instant('SESSIONS_DASHBOARD.STATUS_PRESENT'), value: 'PRESENT' },
      { label: this.translate.instant('SESSIONS_DASHBOARD.STATUS_ABSENT'), value: 'ABSENT' },
    ];
  });

  // ── End session ─────────────────────────────────────────────────────────────
  showEndDialog = false;
  endingSession = signal(false);
  endDateDisplay = signal('');
  endSessionForm: FormGroup = this.fb.group({
    endTime: ['', Validators.required],
    notes: [''],
  });

  // ── Post-session messaging (per-staff click-to-chat) ────────────────────
  showAbsenceMessageDialog = signal(false);
  absentStudentsForMessage = signal<
    { studentId: string; name: string; parentName: string | null; parentPhone: string | null; studentPhone: string | null }[]
  >([]);

  ngOnInit() {
    this.sessionId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.sessionId) {
      this.loading.set(false);
      return;
    }
    this.sessionService.getById(this.sessionId).subscribe({
      next: (s) => this.session.set(s),
      error: () => {
        // Interceptor toasted the translated error; the roster still loads below.
      },
    });
    this.loadStudents();
    this.loadDues();
    this.loadEmployees();
    // Warm the click-to-chat templates cache (fire-and-forget).
    this.templatesSvc.load().subscribe({ error: () => {} });

    // Take over the app-wide scanner while this page is open: a scan checks the
    // student into THIS session instead of navigating to their detail page.
    this.globalScan.register(this.scanHandler);

    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mobileQuery = window.matchMedia('(max-width: 767px)');
      this.onViewportChange(this.mobileQuery);
      this.mobileQuery.addEventListener('change', this.onViewportChange);
    }
  }

  // ── Camera check-in ─────────────────────────────────────────────────────────

  openCameraScanner() {
    this.scannerOpen.set(true);
    this.lastScan = '';
    // The preview element only exists once the dialog has rendered.
    setTimeout(() => this.startCamera(), 100);
  }

  closeCameraScanner() {
    this.stopCamera();
    this.scannerOpen.set(false);
  }

  private async startCamera() {
    if (this.html5Qr) return;
    this.cameraStarting.set(true);
    try {
      // Loaded on demand: html5-qrcode is heavy and most attendance is taken
      // with a reader, so it must not sit in this page's chunk.
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      this.html5Qr = new Html5Qrcode(this.SCANNER_ELEMENT_ID);
      await this.html5Qr.start(
        { facingMode: 'environment' },
        cameraScanConfig(Html5QrcodeSupportedFormats),
        (decodedText: string) => this.handleCameraScan(decodedText),
        // Per-frame decode failures are normal (no code in view) — ignore.
        () => {},
      );
    } catch {
      // Close rather than leave a black rectangle with no way forward.
      this.html5Qr = undefined;
      this.scannerOpen.set(false);
      this.notificationService.warning(this.translate.instant('NAV.QR_CAMERA_FAILED'));
    } finally {
      this.cameraStarting.set(false);
    }
  }

  private stopCamera() {
    const qr = this.html5Qr;
    this.html5Qr = undefined;
    if (!qr) return;
    // stop() rejects if it already stopped; swallow it.
    qr.stop().then(() => qr.clear()).catch(() => {});
  }

  /**
   * A camera decode: a card QR, or a barcode of the printed student code. Both
   * resolve to a token, so this lands in exactly the same handler a wedge scan
   * does — including the homework-mode branch and the check-in beep. The camera
   * keeps running, so a queue of students can be scanned one after another.
   */
  private handleCameraScan(decodedText: string) {
    const raw = (decodedText || '').trim();
    if (!raw) return;
    // Dedup on the RAW value: a camera re-reads the same frame many times a
    // second, and a barcode must not fire a lookup per frame.
    const now = Date.now();
    if (raw === this.lastScan && now - this.lastScanAt < this.SCAN_DEDUP_MS) return;
    this.lastScan = raw;
    this.lastScanAt = now;

    this.globalScan.resolveScan(raw).subscribe({
      next: (token) => { if (token) this.scanHandler(token); },
      error: () => this.notificationService.error(this.translate.instant('NAV.QR_STUDENT_NOT_FOUND')),
    });
  }

  loadStudents() {
    this.loading.set(true);
    this.attendanceService.getBySession(this.sessionId).subscribe({
      next: (students) => {
        this.students.set(students.map((s) => ({ ...s })));
        this.loading.set(false);
        this.maybeShowAbsenceBanner();
      },
      error: () => this.loading.set(false),
    });
  }

  loadDues() {
    this.loadingDues.set(true);
    this.attendanceService.getSessionDues(this.sessionId).subscribe({
      next: (res) => {
        this.duesPaymentType.set(res.paymentType);
        this.duesByStudent.set(new Map(res.students.map((s) => [s.studentId, s])));
        this.loadingDues.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error. Leave the map empty: no badge
        // at all beats a green one we couldn't verify.
        this.loadingDues.set(false);
      },
    });
  }

  /** Open the shared collect dialog on this student's oldest outstanding item. */
  openCollect(student: SessionAttendanceStudent) {
    this.collectDialog?.open(`${student.studentName}`.trim(), this.dues(student.studentId));
  }

  /** Flash the top banner for a few seconds when the roster has at-risk students.
   *  The inline ⚠ marks beside each student stay put. */
  private maybeShowAbsenceBanner() {
    if (this.absenceBannerTimer) clearTimeout(this.absenceBannerTimer);
    if (this.atRiskStudents().length === 0) {
      this.showAbsenceBanner.set(false);
      return;
    }
    this.showAbsenceBanner.set(true);
    // Keep the banner up longer when more students are flagged — there's more to
    // read. ~8s for one, growing to a 20s cap. (It only shows when there ARE
    // absences, so this always runs longer than a plain heads-up would.)
    const n = this.atRiskStudents().length;
    const duration = Math.min(20000, 6000 + n * 2000);
    this.absenceBannerTimer = setTimeout(() => this.showAbsenceBanner.set(false), duration);
  }

  dismissAbsenceBanner() {
    if (this.absenceBannerTimer) clearTimeout(this.absenceBannerTimer);
    this.showAbsenceBanner.set(false);
  }

  togglePresence(student: SessionAttendanceStudent, value: boolean) {
    // Any click on the roster is a user gesture — enough for the browser to let the
    // check-in beep play later, now that the scanner button isn't there to prime it.
    this.ensureAudio();
    // SUBSTITUTION and TRIAL attendees aren't part of the enrolled roster the
    // checkbox save manages, so unchecking one removes their attendance row
    // outright (undo a wrong scan). They can't be toggled back on here — re-scan
    // to re-add.
    if (student.attendanceType === 'SUBSTITUTION' || student.attendanceType === 'TRIAL') {
      if (!value) this.confirmChargeThen(student, () => this.removeAttendee(student));
      return;
    }
    // PER_SESSION: un-checking a student who already has a charge deletes that
    // charge (and any payment). Confirm before the destructive save.
    if (!value && student.charge) {
      this.confirmChargeThen(student, () => this.applyPresence(student, false));
      return;
    }
    this.applyPresence(student, value);
  }

  private applyPresence(student: SessionAttendanceStudent, value: boolean) {
    // Clear the local charge when un-checking — it's about to be deleted server-side,
    // so we shouldn't re-prompt for it on a subsequent toggle.
    this.students.update((list) =>
      list.map((s) => (s.studentId === student.studentId ? { ...s, isPresent: value, charge: value ? s.charge : null } : s)),
    );
    this.scheduleSave();
  }

  /** Re-emit the student (unchanged) so a cancelled checkbox snaps back to checked. */
  private revertCheckbox(student: SessionAttendanceStudent) {
    this.students.update((list) =>
      list.map((s) => (s.studentId === student.studentId ? { ...s } : s)),
    );
  }

  /**
   * If the student has a per-session charge, confirm (showing the paid amount)
   * before running the destructive action; otherwise run it immediately.
   */
  private confirmChargeThen(student: SessionAttendanceStudent, onAccept: () => void) {
    const c = student.charge;
    if (!c) { onAccept(); return; }
    const name = `${student.studentName}`.trim();
    const detail = c.amountPaid > 0
      ? this.translate.instant('SESSION_ATTENDANCE.UNCHECK_PAID', { amount: c.amountPaid })
      : this.translate.instant('SESSION_ATTENDANCE.UNCHECK_UNPAID', { amount: c.amountDue });
    this.confirmationService.confirm({
      header: this.translate.instant('SESSION_ATTENDANCE.UNCHECK_TITLE'),
      message: this.translate.instant('SESSION_ATTENDANCE.UNCHECK_MSG', { name }) + ' ' + detail,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('SESSION_ATTENDANCE.UNCHECK_ACCEPT'),
      rejectLabel: this.translate.instant('SESSION_ATTENDANCE.UNCHECK_CANCEL'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: onAccept,
      reject: () => this.revertCheckbox(student),
    });
  }

  /** Remove a (substitution) attendee from the session — undoes a wrong scan. */
  private removeAttendee(student: SessionAttendanceStudent) {
    this.attendanceService.removeAttendee(this.sessionId, student.studentId).subscribe({
      next: () => {
        this.students.update((list) => list.filter((s) => s.studentId !== student.studentId));
        this.notificationService.success(this.translate.instant('SESSIONS_DASHBOARD.ATTENDEE_REMOVED', { name: `${student.studentName}`.trim() }));
      },
      error: () => {
        // Interceptor toasts the translated error.
      },
    });
  }

  /**
   * Mark everyone currently matching the search as present, after confirming.
   * It's one click that writes attendance for the whole visible roster — and on
   * a PER_SESSION course that raises a charge per student — so it asks first and
   * says how many people it is about to affect.
   *
   * Already-present students are excluded so the count reflects what actually
   * changes; substitution and trial attendees are present by definition and so
   * fall out of it too.
   */
  confirmMarkAllPresent() {
    const targets = this.filteredStudents().filter((s) => !s.isPresent);
    if (targets.length === 0) return;
    this.confirmationService.confirm({
      header: this.translate.instant('SESSION_ATTENDANCE.MARK_ALL_TITLE'),
      message: this.translate.instant('SESSION_ATTENDANCE.MARK_ALL_CONFIRM', { count: targets.length }),
      icon: 'pi pi-check-circle',
      acceptLabel: this.translate.instant('SESSION_ATTENDANCE.MARK_ALL_ACCEPT'),
      rejectLabel: this.translate.instant('SESSION_ATTENDANCE.UNCHECK_CANCEL'),
      accept: () => this.applyMarkAll(targets, true),
    });
  }

  private applyMarkAll(targets: SessionAttendanceStudent[], present: boolean) {
    const ids = new Set(targets.map((s) => s.studentId));
    this.students.update((list) =>
      list.map((s) => (ids.has(s.studentId) ? { ...s, isPresent: present } : s)),
    );
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.savedClearTimer) {
      clearTimeout(this.savedClearTimer);
      this.savedClearTimer = undefined;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flushSave();
    }, this.SAVE_DEBOUNCE_MS);
  }

  private flushSave() {
    const presentIds = this.students().filter((s) => s.isPresent).map((s) => s.studentId);
    this.saveState.set('saving');
    this.attendanceService.saveForSession(this.sessionId, presentIds).subscribe({
      next: (res) => {
        this.saveState.set('saved');
        this.savedClearTimer = setTimeout(() => this.saveState.set(undefined), 2000);
        // PER_SESSION courses: prompt to collect any newly-created dues.
        if (res.sessionCharges?.length) this.payDialog?.enqueue(res.sessionCharges);
        // Marking someone present can raise (or un-checking can drop) a charge.
        this.loadDues();
      },
      error: () => this.saveState.set('error'),
    });
  }

  // ============================================================
  // Teacher management
  // ============================================================

  loadEmployees() {
    this.employeeService.getAllEmployees().subscribe({
      next: (list: any[]) => {
        this.allEmployees.set(
          list.map((e: any) => ({
            id: e.id,
            displayName: `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email || 'Unnamed',
          })),
        );
      },
    });
  }

  employeeLabel(id: string): string {
    return this.allEmployees().find((e) => e.id === id)?.displayName || '—';
  }

  toggleTeacherPanel() {
    const open = !this.teacherPanelOpen();
    this.teacherPanelOpen.set(open);
    if (open && this.teacherRows().length === 0) {
      this.loadTeachers();
    }
  }

  loadTeachers() {
    this.loadingTeachers.set(true);
    this.teacherAttendanceService.getBySession(this.sessionId).subscribe({
      next: (rows: SessionTeacherAttendanceRow[]) => {
        this.teacherRows.set(rows.map((r) => ({ employeeId: r.employeeId, role: r.role, status: r.status })));
        this.loadingTeachers.set(false);
      },
      error: () => this.loadingTeachers.set(false),
    });
  }

  addTeacher() {
    const empId = this.newTeacherEmployeeId;
    if (!empId) return;
    const rows = this.teacherRows();
    if (rows.some((t) => t.employeeId === empId)) return;
    const primaryAlreadyPresent = rows.some((t) => t.role === 'PRIMARY' && t.status === 'PRESENT');
    this.teacherRows.update((list) => [
      ...list,
      { employeeId: empId, role: primaryAlreadyPresent ? 'SUBSTITUTE' : 'PRIMARY', status: 'PRESENT' },
    ]);
    this.newTeacherEmployeeId = null;
  }

  removeTeacher(employeeId: string) {
    this.teacherRows.update((list) => list.filter((t) => t.employeeId !== employeeId));
  }

  updateTeacherRole(employeeId: string, role: 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT') {
    this.teacherRows.update((list) => list.map((t) => (t.employeeId === employeeId ? { ...t, role } : t)));
  }

  updateTeacherStatus(employeeId: string, status: 'PRESENT' | 'ABSENT') {
    this.teacherRows.update((list) => list.map((t) => (t.employeeId === employeeId ? { ...t, status } : t)));
  }

  saveTeachers() {
    const payload = this.teacherRows().map((t) => ({ employeeId: t.employeeId, role: t.role, status: t.status }));
    this.savingTeachers.set(true);
    this.teacherAttendanceService.saveForSession(this.sessionId, payload).subscribe({
      next: (res) => {
        this.savingTeachers.set(false);
        this.notificationService.success(this.translate.instant('SESSIONS_DASHBOARD.MSG_TEACHERS_SAVED', { count: res.count }));
      },
      error: () => this.savingTeachers.set(false),
    });
  }

  // ============================================================
  // Start session (upgrade from prepared → started)
  // ============================================================

  startSessionFromPrepared() {
    const s = this.session();
    if (!s) return;
    this.startingSession.set(true);
    this.sessionService.start({
      classId: s.classId,
      branchId: s.branchId,
      roomId: s.roomId || undefined,
    }).subscribe({
      next: (updated) => {
        this.session.set(updated);
        this.startingSession.set(false);
        this.notificationService.success(this.translate.instant('SESSIONS_DASHBOARD.MSG_SESSION_STARTED'));
      },
      error: () => this.startingSession.set(false),
    });
  }

  // ============================================================
  // End session
  // ============================================================

  confirmEndSession() {
    const s = this.session();
    if (!s) return;
    const now = new Date();
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const startDate = new Date(s.startDate);
    this.endDateDisplay.set(
      startDate.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
    );
    this.endSessionForm = this.fb.group({
      endTime: [defaultTime, [Validators.required, endTimeAfterStartValidator(s.startDate)]],
      notes: [''],
    });
    this.showEndDialog = true;
  }

  endSession() {
    const s = this.session();
    if (!s || this.endSessionForm.invalid) {
      this.endSessionForm.markAllAsTouched();
      return;
    }
    const startDate = new Date(s.startDate);
    const [hours, minutes] = (this.endSessionForm.value.endTime as string).split(':').map(Number);
    const endDateTime = new Date(startDate);
    endDateTime.setHours(hours, minutes, 0, 0);

    this.endingSession.set(true);
    this.sessionService.end(s.id, this.endSessionForm.value.notes || undefined, endDateTime.toISOString()).subscribe({
      next: () => {
        this.endingSession.set(false);
        this.showEndDialog = false;
        this.notificationService.success(this.translate.instant('SESSIONS_DASHBOARD.MSG_SESSION_ENDED'));
        // Show absence message dialog if there are absent students
        const absent = this.students().filter(st => !st.isPresent);
        if (absent.length > 0) {
          this.absentStudentsForMessage.set(
            absent.map(st => ({
              studentId: st.studentId,
              name: `${st.studentName}`.trim(),
              parentName: st.parentName ?? null,
              parentPhone: st.parentPhone ?? null,
              studentPhone: st.studentPhone ?? null,
            })),
          );
          this.showAbsenceMessageDialog.set(true);
        } else {
          this.router.navigate(['/sessions']);
        }
      },
      error: () => this.endingSession.set(false),
    });
  }

  // ── Absence messaging after session end (per-staff click-to-chat) ───────

  /**
   * Open the parent's WhatsApp chat pre-filled with the ABSENCE template,
   * sent from the staff member's own number. Does NOT navigate away — staff
   * may send to several parents from the same dialog.
   */
  sendAbsenceMessage(stu: { studentId: string; name: string; parentName: string | null; parentPhone: string | null; studentPhone: string | null }) {
    const s = this.session();
    if (!s) return;
    const studentName = stu.name;
    const vars = {
      studentName,
      parentName: stu.parentName || studentName,
      academyName: this.auth.getCompanyName(),
      className: s.className || '',
      courseName: s.courseName || '',
      sessionNumber: String(s.sessionNumber ?? ''),
      date: new Date(s.startDate).toLocaleDateString('en-GB'),
    };
    const text = renderWhatsappTemplate(this.templatesSvc.get('ABSENCE'), vars);
    const opened = openWhatsappChat(stu.parentPhone, text);
    if (!opened) {
      this.notificationService.info(this.translate.instant('WHATSAPP.NO_PHONE'));
    }
  }

  skipAbsenceMessages() {
    this.showAbsenceMessageDialog.set(false);
    this.router.navigate(['/sessions']);
  }

  // ============================================================
  // QR check-in
  // ============================================================

  private ensureAudio() {
    if (!this.audioCtx) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (Ctx) this.audioCtx = new Ctx();
    }
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
  }

  /**
   * Loud beep on check-in. A fresh "marked present" plays two ascending tones;
   * an already-present re-scan plays a single lower tone so staff can tell them
   * apart by ear in a noisy room. Square wave + high gain = carries.
   */
  private playBeep(freshCheckin: boolean) {
    this.ensureAudio();
    const ctx = this.audioCtx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const tones = freshCheckin ? [880, 1320] : [520];
    tones.forEach((freq, i) => {
      const start = now + i * 0.13;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.9, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  }

  /**
   * Unified search box submit (Enter). One input searches the roster by name OR
   * student code, and pressing Enter "takes attendance":
   *  - a numeric value → treated as a student code: resolve it and check the
   *    student in (works even if they're not in the current filter). A missing
   *    code surfaces the translated "no student with this code" warning.
   *  - otherwise, if the name filter narrows to exactly one student → mark that
   *    student present.
   */
  submitSearch() {
    this.ensureAudio();
    const q = this.search().trim();
    if (!q) return;

    if (/^\d+$/.test(q)) {
      this.resolvingCode.set(true);
      this.studentService.lookupByCode(q).subscribe({
        next: ({ qrToken }) => {
          this.resolvingCode.set(false);
          this.checkin(qrToken);
          this.search.set('');
        },
        error: () => {
          // Interceptor toasts the translated "no student with this code" message.
          this.resolvingCode.set(false);
          this.lastScanResult.set(null);
        },
      });
      return;
    }

    const matches = this.filteredStudents();
    if (matches.length === 1) {
      this.togglePresence(matches[0], true);
      this.search.set('');
    }
  }

  private checkin(token: string) {
    this.attendanceService.checkinByQr(this.sessionId, token).subscribe({
      next: (res) => {
        const name = `${res.studentName}`;
        const isSub = res.attendanceType === 'SUBSTITUTION';
        // A trial attendee has no enrolment in this class either, so like a
        // substitution they must be appended to the roster rather than matched.
        const isTrial = res.attendanceType === 'TRIAL';
        this.lastScanResult.set({ name, alreadyPresent: res.alreadyPresent, attendanceType: res.attendanceType, homeClassName: res.homeClassName });
        this.playBeep(!res.alreadyPresent);
        // Reflect in the local roster so a later checkbox save doesn't drop it.
        // Substitution attendees may not be in the enrolled roster — add them.
        this.students.update((list) => {
          const exists = list.some((s) => s.studentId === res.studentId);
          if (exists) {
            return list.map((s) => (s.studentId === res.studentId
              ? { ...s, isPresent: true, attendanceType: res.attendanceType ?? s.attendanceType, homeClassName: res.homeClassName ?? s.homeClassName }
              : s));
          }
          return [...list, {
            studentId: res.studentId,
            studentName: res.studentName,
            studentCode: res.studentCode ?? null,
            isPresent: true,
            attendanceType: res.attendanceType ?? null,
            homeClassName: res.homeClassName ?? null,
            isEnrolled: !isSub && !isTrial,
          }];
        });
        if (isSub) {
          this.notificationService.success(this.translate.instant('SESSION_QR.SUBSTITUTION_CHECKED_IN', { name, className: res.homeClassName }));
        } else if (isTrial && !res.alreadyPresent) {
          this.notificationService.success(this.translate.instant('SESSION_QR.TRIAL_CHECKED_IN', { name }));
        } else if (res.alreadyPresent) {
          this.notificationService.info(this.translate.instant('SESSION_QR.ALREADY_PRESENT', { name }));
        } else {
          this.notificationService.success(this.translate.instant('SESSION_QR.CHECKED_IN', { name }));
        }
        // PER_SESSION courses: prompt to collect this check-in's charge (fresh only).
        if (!res.alreadyPresent && res.sessionCharge) this.payDialog?.enqueue([res.sessionCharge]);
        if (!res.alreadyPresent) this.loadDues();
      },
      error: () => {
        // Interceptor toasts the translated server error (unknown token / not enrolled).
        this.lastScanResult.set(null);
      },
    });
  }

  ngOnDestroy() {
    this.globalScan.unregister(this.scanHandler);
    this.stopCamera();
    this.mobileQuery?.removeEventListener('change', this.onViewportChange);
    this.audioCtx?.close().catch(() => {});
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.savedClearTimer) clearTimeout(this.savedClearTimer);
    if (this.absenceBannerTimer) clearTimeout(this.absenceBannerTimer);
  }

  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  // ============================================================
  // Session number inline edit
  // ============================================================

  startEditNumber() {
    this.numberDraft.set(this.session()?.sessionNumber ?? null);
    this.editingNumber.set(true);
  }

  cancelEditNumber() {
    this.editingNumber.set(false);
  }

  saveSessionNumber() {
    const n = this.numberDraft();
    if (n == null || n < 1) return;
    this.savingNumber.set(true);
    this.sessionService.update(this.sessionId, { sessionNumber: Number(n) }).subscribe({
      next: (s) => {
        this.session.set(s);
        this.savingNumber.set(false);
        this.editingNumber.set(false);
        this.notificationService.success(this.translate.instant('SESSIONS_DASHBOARD.MSG_SESSION_NUMBER_SAVED'));
      },
      error: () => this.savingNumber.set(false),
    });
  }
}
