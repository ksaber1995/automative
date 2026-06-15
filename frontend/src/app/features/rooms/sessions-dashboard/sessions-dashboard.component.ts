import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { TabsModule } from 'primeng/tabs';
import { InputTextModule } from 'primeng/inputtext';
import { CheckboxModule } from 'primeng/checkbox';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SessionService, Session, StartSessionTeacher } from '../services/session.service';
import { RoomService, Room } from '../services/room.service';
import { AttendanceService, SessionAttendanceStudent } from '../services/attendance.service';
import { TeacherAttendanceService, SessionTeacherAttendanceRow } from '../../attendance/services/teacher-attendance.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ClassService } from '../../courses/services/class.service';
import { BranchService } from '../../branches/services/branch.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { LanguageService } from '../../../core/services/language.service';
import { Branch } from '@shared/interfaces/branch.interface';

interface DialogTeacherRow {
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

    if (end < start) {
      return { endBeforeStart: true };
    }
    return null;
  };
}

@Component({
  selector: 'app-sessions-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TagModule,
    TableModule,
    DialogModule,
    SelectModule,
    TextareaModule,
    TooltipModule,
    TabsModule,
    InputTextModule,
    CheckboxModule,
    TranslateModule,
  ],
  templateUrl: './sessions-dashboard.component.html',
})
export class SessionsDashboardComponent implements OnInit {
  private sessionService = inject(SessionService);
  private roomService = inject(RoomService);
  private classService = inject(ClassService);
  private branchService = inject(BranchService);
  protected branchState = inject(BranchStateService);
  private attendanceService = inject(AttendanceService);
  private teacherAttendanceService = inject(TeacherAttendanceService);
  private employeeService = inject(EmployeeService);
  private notificationService = inject(NotificationService);
  private fb = inject(FormBuilder);

  // ── Teacher attendance in Start dialog ─────────────────────────────────────
  dialogTeachers = signal<DialogTeacherRow[]>([]);
  allEmployees = signal<TeacherOption[]>([]);
  /** Employees not yet picked in dialogTeachers — used to populate the "add" select. */
  availableEmployees = computed<TeacherOption[]>(() => {
    const used = new Set(this.dialogTeachers().map((t) => t.employeeId));
    return this.allEmployees().filter((e) => !used.has(e.id));
  });
  newTeacherEmployeeId: string | null = null;
  private translate = inject(TranslateService);
  private languageService = inject(LanguageService);

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

  employeeLabel(id: string): string {
    return this.allEmployees().find((e) => e.id === id)?.displayName || '—';
  }

  addTeacherToDialog() {
    if (!this.newTeacherEmployeeId) return;
    const exists = this.dialogTeachers().some((t) => t.employeeId === this.newTeacherEmployeeId);
    if (exists) return;
    const primaryAlreadyPresent = this.dialogTeachers().some(
      (t) => t.role === 'PRIMARY' && t.status === 'PRESENT',
    );
    this.dialogTeachers.update((rows) => [
      ...rows,
      {
        employeeId: this.newTeacherEmployeeId!,
        role: primaryAlreadyPresent ? 'SUBSTITUTE' : 'PRIMARY',
        status: 'PRESENT',
      },
    ]);
    this.newTeacherEmployeeId = null;
  }

  removeTeacherFromDialog(employeeId: string) {
    this.dialogTeachers.update((rows) => rows.filter((t) => t.employeeId !== employeeId));
  }

  updateTeacherRole(employeeId: string, role: 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT') {
    this.dialogTeachers.update((rows) =>
      rows.map((t) => (t.employeeId === employeeId ? { ...t, role } : t)),
    );
  }

  updateTeacherStatus(employeeId: string, status: 'PRESENT' | 'ABSENT') {
    this.dialogTeachers.update((rows) =>
      rows.map((t) => (t.employeeId === employeeId ? { ...t, status } : t)),
    );
  }

  /** Prefill the dialog's teacher list with the class's instructor when the class changes. */
  onDialogClassChange() {
    const classId = this.sessionForm.get('classId')?.value;
    if (!classId) return;

    // Toggle room validator based on class type (online classes don't require a room)
    const cls = this.dialogActiveClasses().find((c) => c.id === classId);
    const isOnline = (cls?.type || '').toUpperCase() === 'ONLINE';
    const roomCtrl = this.sessionForm.get('roomId');
    if (roomCtrl) {
      if (isOnline) {
        roomCtrl.clearValidators();
        roomCtrl.setValue('');
      } else {
        roomCtrl.setValidators([Validators.required]);
      }
      roomCtrl.updateValueAndValidity({ emitEvent: false });
    }

    // Prefill the suggested session number for this class's course (editable).
    this.sessionService.nextNumber(classId).subscribe({
      next: (res) => this.sessionForm.get('sessionNumber')?.setValue(res.sessionNumber),
      error: () => {},
    });

    // If the user already added rows, don't overwrite — they're driving.
    if (this.dialogTeachers().length > 0) return;
    const instructorId = cls?.instructorId || cls?.instructor_id;
    if (instructorId) {
      this.dialogTeachers.set([{ employeeId: instructorId, role: 'PRIMARY', status: 'PRESENT' }]);
    }
  }

  /** Computed: is the currently-selected class in the dialog an online class? */
  isSelectedClassOnline(): boolean {
    const classId = this.sessionForm?.get('classId')?.value;
    if (!classId) return false;
    const cls = this.dialogActiveClasses().find((c) => c.id === classId);
    return (cls?.type || '').toUpperCase() === 'ONLINE';
  }

  activeSessions = signal<Session[]>([]);
  allSessions = signal<Session[]>([]);
  rooms = signal<Room[]>([]);
  branches = signal<Branch[]>([]);
  activeClasses = signal<any[]>([]);

  loadingActive = signal(true);
  loadingHistory = signal(true);
  loadingRooms = signal(true);
  saving = signal(false);

  activeTab = 'active';
  showStartDialog = false;
  showEndDialog = false;
  endingSession = signal<Session | null>(null);

  /** Page-level branch filter (null = all branches) */
  selectedBranchId = signal<string | null>(null);

  /** Start session form */
  sessionForm: FormGroup = this.fb.group({
    branchId: ['', Validators.required],
    roomId: ['', Validators.required],
    classId: ['', Validators.required],
    notes: [''],
  });

  /** End session form */
  endSessionForm: FormGroup = this.fb.group({
    endTime: ['', Validators.required],
    notes: [''],
  });

  /** Display-only date label for the locked end-date field */
  endDateDisplay = signal<string>('');

  /** Inline attendance accordion state */
  expandedAttendanceSessionId = signal<string | null>(null);
  loadingAttendanceFor = signal<string | null>(null);
  savingAttendanceFor = signal<string | null>(null);
  attendanceBySession = signal<Record<string, SessionAttendanceStudent[]>>({});
  /** Per-session UI state for the auto-save indicator */
  attendanceSaveState = signal<Record<string, 'saving' | 'saved' | 'error' | undefined>>({});
  /** Pending debounce timers per session, keyed by sessionId */
  private attendanceSaveTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  /** Timers that clear the "Saved" badge after a moment */
  private attendanceSavedClearTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private readonly ATTENDANCE_SAVE_DEBOUNCE_MS = 600;

  /** Inline teacher-attendance accordion state */
  expandedTeachersSessionId = signal<string | null>(null);
  loadingTeachersFor = signal<string | null>(null);
  savingTeachersFor = signal<string | null>(null);
  teachersBySession = signal<Record<string, DialogTeacherRow[]>>({});
  /** ngModel target for the "add teacher" select inside each session card. Keyed by sessionId. */
  newSessionTeacherIds: Record<string, string | null> = {};

  // ── Page-level filtered rooms ──────────────────────────────────────────────

  filteredRooms = computed(() => {
    const all = this.rooms();
    const branchId = this.selectedBranchId();
    if (!branchId) return all;
    return all.filter((r: Room) => r.branchId === branchId);
  });

  filteredActiveSessions = computed(() => {
    const branchId = this.selectedBranchId();
    if (!branchId) return this.activeSessions();
    return this.activeSessions().filter((s: Session) => s.branchId === branchId);
  });

  filteredAllSessions = computed(() => {
    const branchId = this.selectedBranchId();
    if (!branchId) return this.allSessions();
    return this.allSessions().filter((s: Session) => s.branchId === branchId);
  });

  filteredOccupiedRooms = computed(() => this.filteredRooms().filter((r: Room) => r.isOccupied));
  filteredFreeRooms = computed(() => this.filteredRooms().filter((r: Room) => !r.isOccupied && r.isActive));

  // ── Dialog-level data ───────────────────────────────────────────────────────
  dialogFreeRooms = signal<Room[]>([]);
  /** Only classes with at least 1 enrolled student; active-session ones are marked disabled */
  dialogActiveClasses = signal<any[]>([]);
  loadingDialogClasses = signal(false);

  freeRooms = computed(() => this.rooms().filter((r: Room) => !r.isOccupied && r.isActive));
  occupiedRooms = computed(() => this.rooms().filter((r: Room) => r.isOccupied));

  ngOnInit() {
    this.loadBranches();
    this.loadAll();
  }

  loadBranches() {
    this.branchService.getAllBranches().subscribe({
      next: (b: Branch[]) => this.branches.set(b),
    });
  }

  loadAll() {
    this.loadActiveSessions();
    this.loadRooms();
    this.loadHistory();
    this.loadClasses();
    this.loadEmployees();
  }

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

  loadActiveSessions() {
    this.loadingActive.set(true);
    this.sessionService.listActive().subscribe({
      next: (s: Session[]) => { this.activeSessions.set(s); this.loadingActive.set(false); },
      error: () => this.loadingActive.set(false),
    });
  }

  loadRooms() {
    this.loadingRooms.set(true);
    this.roomService.list().subscribe({
      next: (r: Room[]) => { this.rooms.set(r); this.loadingRooms.set(false); },
      error: () => this.loadingRooms.set(false),
    });
  }

  loadHistory() {
    this.loadingHistory.set(true);
    this.sessionService.list().subscribe({
      next: (s: Session[]) => { this.allSessions.set(s); this.loadingHistory.set(false); },
      error: () => this.loadingHistory.set(false),
    });
  }

  loadClasses() {
    this.classService.getActiveClasses().subscribe({
      next: (classes: any[]) => {
        this.activeClasses.set(classes.map((c: any) => ({
          ...c,
          displayName: `${c.name} (${c.code})`,
        })));
      },
      error: () => {},
    });
  }

  openStartDialog() {
    // Single-branch companies hide the branch picker, so preselect the only
    // branch and load its rooms/classes up front.
    const only = this.branchState.onlyBranchId();
    this.buildSessionForm(undefined, only || undefined);
    if (only) this.populateDialogOptionsForBranch(only);
    this.showStartDialog = true;
  }

  /** Open the full-page attendance editor for a session in a new browser tab.
   * The inline accordion is too small for large classes; the dedicated page
   * adds search + bulk actions for rosters of 100+ students. */
  openAttendancePage(session: Session) {
    window.open(`/sessions/${session.id}/attendance`, '_blank');
  }

  openStartDialogForRoom(room: Room) {
    this.buildSessionForm(room.id, room.branchId);
    this.populateDialogOptionsForBranch(room.branchId);
    this.showStartDialog = true;
  }

  private populateDialogOptionsForBranch(branchId: string) {
    this.dialogFreeRooms.set(
      this.rooms().filter((r: Room) => r.branchId === branchId && !r.isOccupied && r.isActive)
    );
    this.loadingDialogClasses.set(true);
    this.classService.getClassesByBranch(branchId).subscribe({
      next: (classes: any[]) => {
        this.dialogActiveClasses.set(
          classes
            .filter((c: any) => (c.studentCount ?? 0) > 0)
            .map((c: any) => ({
              ...c,
              displayName: `${c.name} (${c.code})`,
            }))
        );
        this.loadingDialogClasses.set(false);
      },
      error: () => this.loadingDialogClasses.set(false),
    });
  }

  buildSessionForm(roomId?: string, branchId?: string) {
    this.sessionForm = this.fb.group({
      branchId: [branchId || '', Validators.required],
      roomId: [roomId || '', Validators.required],
      classId: ['', Validators.required],
      sessionNumber: [null as number | null],
      notes: [''],
    });
    this.dialogTeachers.set([]);
    this.newTeacherEmployeeId = null;
  }

  /** When the branch changes inside the dialog, reset room + class and reload both for the branch */
  onDialogBranchChange() {
    this.sessionForm.patchValue({ roomId: '', classId: '' });
    const branchId = this.sessionForm.get('branchId')?.value;
    if (!branchId) {
      this.dialogFreeRooms.set([]);
      this.dialogActiveClasses.set([]);
      return;
    }
    this.populateDialogOptionsForBranch(branchId);
  }

  startSession() {
    if (this.sessionForm.invalid) { this.sessionForm.markAllAsTouched(); return; }
    this.saving.set(true);
    const val = this.sessionForm.value;

    const teachers: StartSessionTeacher[] = this.dialogTeachers().map((t) => ({
      employeeId: t.employeeId,
      role: t.role,
      status: t.status,
    }));

    this.sessionService.start({
      roomId: val.roomId || undefined,
      classId: val.classId,
      branchId: val.branchId,
      notes: val.notes || undefined,
      sessionNumber: val.sessionNumber != null && val.sessionNumber !== '' ? Number(val.sessionNumber) : undefined,
      teachers: teachers.length > 0 ? teachers : undefined,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showStartDialog = false;
        this.notificationService.success(this.translate.instant('SESSIONS_DASHBOARD.MSG_SESSION_STARTED'));
        this.loadAll();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.saving.set(false);
      },
    });
  }

  confirmEndSession(session: Session) {
    this.endingSession.set(session);

    // Default end time = current time (HH:mm)
    const now = new Date();
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Build the locked date display (same date as start date)
    const startDate = new Date(session.startDate);
    this.endDateDisplay.set(
      startDate.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
    );

    // Rebuild end session form with the validator bound to this session's startDate
    this.endSessionForm = this.fb.group({
      endTime: [defaultTime, [Validators.required, endTimeAfterStartValidator(session.startDate)]],
      notes: [''],
    });

    this.showEndDialog = true;
  }

  onEndDialogHide() {
    this.endingSession.set(null);
    this.endSessionForm.reset();
  }

  endSession() {
    if (this.endSessionForm.invalid) { this.endSessionForm.markAllAsTouched(); return; }

    const session = this.endingSession();
    if (!session) return;

    // Build the ISO end datetime: start date + chosen time
    const startDate = new Date(session.startDate);
    const [hours, minutes] = (this.endSessionForm.value.endTime as string).split(':').map(Number);
    const endDateTime = new Date(startDate);
    endDateTime.setHours(hours, minutes, 0, 0);

    this.saving.set(true);
    this.sessionService.end(
      session.id,
      this.endSessionForm.value.notes || undefined,
      endDateTime.toISOString(),
    ).subscribe({
      next: () => {
        this.saving.set(false);
        this.showEndDialog = false;
        this.endingSession.set(null);
        this.notificationService.success(this.translate.instant('SESSIONS_DASHBOARD.MSG_SESSION_ENDED'));
        this.loadAll();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.saving.set(false);
      },
    });
  }

  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
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

  // ── Attendance accordion ──────────────────────────────────────────────────

  toggleAttendance(session: Session) {
    if (this.expandedAttendanceSessionId() === session.id) {
      this.expandedAttendanceSessionId.set(null);
      return;
    }
    this.expandedAttendanceSessionId.set(session.id);
    if (!this.attendanceBySession()[session.id]) {
      this.loadAttendanceForSession(session.id);
    }
  }

  loadAttendanceForSession(sessionId: string) {
    this.loadingAttendanceFor.set(sessionId);
    this.attendanceService.getBySession(sessionId).subscribe({
      next: (students) => {
        this.attendanceBySession.set({
          ...this.attendanceBySession(),
          [sessionId]: students.map(s => ({ ...s })),
        });
        this.loadingAttendanceFor.set(null);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loadingAttendanceFor.set(null);
      },
    });
  }

  getAttendanceStudents(sessionId: string): SessionAttendanceStudent[] {
    return this.attendanceBySession()[sessionId] || [];
  }

  presentCountForSession(sessionId: string): number {
    return this.getAttendanceStudents(sessionId).filter(s => s.isPresent).length;
  }

  absentCountForSession(sessionId: string): number {
    return this.getAttendanceStudents(sessionId).filter(s => !s.isPresent).length;
  }

  /**
   * Called when the user toggles a student's checkbox. Updates local state immediately
   * and schedules a debounced save so rapid toggles only fire one network call.
   */
  toggleStudentPresence(sessionId: string, student: SessionAttendanceStudent, value: boolean) {
    const updated = this.getAttendanceStudents(sessionId).map((s) =>
      s.studentId === student.studentId ? { ...s, isPresent: value } : s,
    );
    this.attendanceBySession.set({
      ...this.attendanceBySession(),
      [sessionId]: updated,
    });

    if (this.attendanceSaveTimers[sessionId]) {
      clearTimeout(this.attendanceSaveTimers[sessionId]);
    }
    if (this.attendanceSavedClearTimers[sessionId]) {
      clearTimeout(this.attendanceSavedClearTimers[sessionId]);
      delete this.attendanceSavedClearTimers[sessionId];
    }
    this.attendanceSaveTimers[sessionId] = setTimeout(() => {
      delete this.attendanceSaveTimers[sessionId];
      this.flushAttendanceSave(sessionId);
    }, this.ATTENDANCE_SAVE_DEBOUNCE_MS);
  }

  private flushAttendanceSave(sessionId: string) {
    const students = this.getAttendanceStudents(sessionId);
    const presentIds = students.filter((s) => s.isPresent).map((s) => s.studentId);
    this.attendanceSaveState.set({ ...this.attendanceSaveState(), [sessionId]: 'saving' });
    this.attendanceService.saveForSession(sessionId, presentIds).subscribe({
      next: () => {
        this.attendanceSaveState.set({ ...this.attendanceSaveState(), [sessionId]: 'saved' });
        this.attendanceSavedClearTimers[sessionId] = setTimeout(() => {
          const next = { ...this.attendanceSaveState() };
          delete next[sessionId];
          this.attendanceSaveState.set(next);
          delete this.attendanceSavedClearTimers[sessionId];
        }, 2000);
      },
      error: () => {
        // Interceptor toasted the translated error; also flip the per-row indicator.
        this.attendanceSaveState.set({ ...this.attendanceSaveState(), [sessionId]: 'error' });
      },
    });
  }

  // ── Live teacher-attendance editor on the active session card ──────────────

  toggleTeachers(session: Session) {
    if (this.expandedTeachersSessionId() === session.id) {
      this.expandedTeachersSessionId.set(null);
      return;
    }
    this.expandedTeachersSessionId.set(session.id);
    if (!this.teachersBySession()[session.id]) {
      this.loadTeachersForSession(session.id);
    }
  }

  loadTeachersForSession(sessionId: string) {
    this.loadingTeachersFor.set(sessionId);
    this.teacherAttendanceService.getBySession(sessionId).subscribe({
      next: (rows: SessionTeacherAttendanceRow[]) => {
        this.teachersBySession.set({
          ...this.teachersBySession(),
          [sessionId]: rows.map((r) => ({
            employeeId: r.employeeId,
            role: r.role,
            status: r.status,
          })),
        });
        this.loadingTeachersFor.set(null);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loadingTeachersFor.set(null);
      },
    });
  }

  getTeacherRows(sessionId: string): DialogTeacherRow[] {
    return this.teachersBySession()[sessionId] || [];
  }

  availableEmployeesFor(sessionId: string): TeacherOption[] {
    const used = new Set(this.getTeacherRows(sessionId).map((t) => t.employeeId));
    return this.allEmployees().filter((e) => !used.has(e.id));
  }

  addSessionTeacher(sessionId: string) {
    const empId = this.newSessionTeacherIds[sessionId];
    if (!empId) return;
    const rows = this.getTeacherRows(sessionId);
    if (rows.some((t) => t.employeeId === empId)) return;
    const primaryAlreadyPresent = rows.some((t) => t.role === 'PRIMARY' && t.status === 'PRESENT');
    const newRow: DialogTeacherRow = {
      employeeId: empId,
      role: primaryAlreadyPresent ? 'SUBSTITUTE' : 'PRIMARY',
      status: 'PRESENT',
    };
    this.teachersBySession.set({
      ...this.teachersBySession(),
      [sessionId]: [...rows, newRow],
    });
    this.newSessionTeacherIds[sessionId] = null;
  }

  removeSessionTeacher(sessionId: string, employeeId: string) {
    this.teachersBySession.set({
      ...this.teachersBySession(),
      [sessionId]: this.getTeacherRows(sessionId).filter((t) => t.employeeId !== employeeId),
    });
  }

  updateSessionTeacherRole(sessionId: string, employeeId: string, role: 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT') {
    this.teachersBySession.set({
      ...this.teachersBySession(),
      [sessionId]: this.getTeacherRows(sessionId).map((t) => (t.employeeId === employeeId ? { ...t, role } : t)),
    });
  }

  updateSessionTeacherStatus(sessionId: string, employeeId: string, status: 'PRESENT' | 'ABSENT') {
    this.teachersBySession.set({
      ...this.teachersBySession(),
      [sessionId]: this.getTeacherRows(sessionId).map((t) => (t.employeeId === employeeId ? { ...t, status } : t)),
    });
  }

  saveTeachersForSession(sessionId: string) {
    const payload = this.getTeacherRows(sessionId).map((t) => ({
      employeeId: t.employeeId,
      role: t.role,
      status: t.status,
    }));
    this.savingTeachersFor.set(sessionId);
    this.teacherAttendanceService.saveForSession(sessionId, payload).subscribe({
      next: (res) => {
        this.savingTeachersFor.set(null);
        this.notificationService.success(this.translate.instant('SESSIONS_DASHBOARD.MSG_TEACHERS_SAVED', { count: res.count }));
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.savingTeachersFor.set(null);
      },
    });
  }
}
