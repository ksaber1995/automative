import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule, FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Html5Qrcode } from 'html5-qrcode';
import { SessionService, Session } from '../services/session.service';
import { AttendanceService, SessionAttendanceStudent } from '../services/attendance.service';
import { TeacherAttendanceService, SessionTeacherAttendanceRow } from '../../attendance/services/teacher-attendance.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { LanguageService } from '../../../core/services/language.service';
import { NotificationService } from '../../../core/services/notification.service';

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
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule, CardModule, ButtonModule, CheckboxModule, InputTextModule, SelectModule, DialogModule, TextareaModule, TooltipModule, TranslateModule],
  templateUrl: './session-attendance.component.html',
})
export class SessionAttendanceComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private sessionService = inject(SessionService);
  private attendanceService = inject(AttendanceService);
  private teacherAttendanceService = inject(TeacherAttendanceService);
  private employeeService = inject(EmployeeService);
  private languageService = inject(LanguageService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private fb = inject(FormBuilder);

  sessionId = '';
  session = signal<Session | null>(null);
  students = signal<SessionAttendanceStudent[]>([]);
  loading = signal(true);
  search = signal('');
  saveState = signal<'saving' | 'saved' | 'error' | undefined>(undefined);

  // QR check-in
  scannerOpen = signal(false);
  scannerStarting = signal(false);
  manualToken = signal('');
  lastScanResult = signal<{ name: string; alreadyPresent: boolean; attendanceType?: 'NORMAL' | 'SUBSTITUTION'; homeClassName?: string | null } | null>(null);

  // Session number inline edit
  editingNumber = signal(false);
  numberDraft = signal<number | null>(null);
  savingNumber = signal(false);
  private readonly SCANNER_ELEMENT_ID = 'qr-scanner-region';
  private html5Qr?: Html5Qrcode;
  // Web Audio context for the check-in beep. Created on the user gesture that
  // opens the scanner (browsers block audio without one).
  private audioCtx?: AudioContext;
  // Suppress the rapid repeat decodes html5-qrcode fires for one physical scan.
  private lastToken = '';
  private lastTokenAt = 0;
  private readonly SCAN_DEDUP_MS = 2500;

  private saveTimer?: ReturnType<typeof setTimeout>;
  private savedClearTimer?: ReturnType<typeof setTimeout>;
  private readonly SAVE_DEBOUNCE_MS = 600;

  filteredStudents = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.students();
    if (!q) return list;
    return list.filter((s) =>
      `${s.studentFirstName} ${s.studentLastName}`.toLowerCase().includes(q),
    );
  });

  presentCount = computed(() => this.students().filter((s) => s.isPresent).length);
  absentCount = computed(() => this.students().filter((s) => !s.isPresent).length);

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
    this.loadEmployees();
  }

  loadStudents() {
    this.loading.set(true);
    this.attendanceService.getBySession(this.sessionId).subscribe({
      next: (students) => {
        this.students.set(students.map((s) => ({ ...s })));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  togglePresence(student: SessionAttendanceStudent, value: boolean) {
    this.students.update((list) =>
      list.map((s) => (s.studentId === student.studentId ? { ...s, isPresent: value } : s)),
    );
    this.scheduleSave();
  }

  /** Bulk-set every student currently matching the search filter. */
  markAllFiltered(present: boolean) {
    const ids = new Set(this.filteredStudents().map((s) => s.studentId));
    if (ids.size === 0) return;
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
      next: () => {
        this.saveState.set('saved');
        this.savedClearTimer = setTimeout(() => this.saveState.set(undefined), 2000);
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
        // Redirect back to the sessions dashboard after ending.
        this.router.navigate(['/sessions']);
      },
      error: () => this.endingSession.set(false),
    });
  }

  // ============================================================
  // QR check-in
  // ============================================================

  /** Open the scanner panel and start the camera. */
  async openScanner() {
    this.scannerOpen.set(true);
    this.lastScanResult.set(null);
    // This click is the user gesture browsers require before audio can play.
    this.ensureAudio();
    // Wait a tick so the #qr-scanner-region element exists in the DOM.
    setTimeout(() => this.startCamera(), 0);
  }

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

  closeScanner() {
    this.stopCamera();
    this.scannerOpen.set(false);
  }

  private async startCamera() {
    if (this.html5Qr) return;
    this.scannerStarting.set(true);
    try {
      this.html5Qr = new Html5Qrcode(this.SCANNER_ELEMENT_ID);
      await this.html5Qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => this.handleScan(decodedText),
        // Per-frame decode failures are normal (no QR in view) — ignore.
        () => {},
      );
    } catch {
      this.notificationService.error(this.translate.instant('SESSION_QR.CAMERA_FAILED'));
      this.html5Qr = undefined;
    } finally {
      this.scannerStarting.set(false);
    }
  }

  private stopCamera() {
    const qr = this.html5Qr;
    this.html5Qr = undefined;
    if (!qr) return;
    // stop() rejects if already stopped; swallow it.
    qr.stop().then(() => qr.clear()).catch(() => {});
  }

  /** Extract the token from a scanned value: either a full profile URL or the raw token. */
  private extractToken(text: string): string {
    const raw = (text || '').trim();
    const marker = '/p/s/';
    const idx = raw.indexOf(marker);
    if (idx >= 0) {
      return raw.slice(idx + marker.length).split(/[/?#]/)[0];
    }
    return raw;
  }

  /** Camera decode callback. */
  private handleScan(decodedText: string) {
    const token = this.extractToken(decodedText);
    if (!token) return;
    const now = Date.now();
    if (token === this.lastToken && now - this.lastTokenAt < this.SCAN_DEDUP_MS) return;
    this.lastToken = token;
    this.lastTokenAt = now;
    this.checkin(token);
  }

  /** USB scanner / manual entry submit (Enter key). */
  submitManualToken() {
    const token = this.extractToken(this.manualToken());
    this.manualToken.set('');
    if (!token) return;
    this.checkin(token);
  }

  private checkin(token: string) {
    this.attendanceService.checkinByQr(this.sessionId, token).subscribe({
      next: (res) => {
        const name = `${res.studentFirstName} ${res.studentLastName}`;
        const isSub = res.attendanceType === 'SUBSTITUTION';
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
            studentFirstName: res.studentFirstName,
            studentLastName: res.studentLastName,
            isPresent: true,
            attendanceType: res.attendanceType ?? null,
            homeClassName: res.homeClassName ?? null,
            isEnrolled: !isSub,
          }];
        });
        if (isSub) {
          this.notificationService.success(this.translate.instant('SESSION_QR.SUBSTITUTION_CHECKED_IN', { name, className: res.homeClassName }));
        } else if (res.alreadyPresent) {
          this.notificationService.info(this.translate.instant('SESSION_QR.ALREADY_PRESENT', { name }));
        } else {
          this.notificationService.success(this.translate.instant('SESSION_QR.CHECKED_IN', { name }));
        }
      },
      error: () => {
        // Interceptor toasts the translated server error (unknown token / not enrolled).
        this.lastScanResult.set(null);
      },
    });
  }

  ngOnDestroy() {
    this.stopCamera();
    this.audioCtx?.close().catch(() => {});
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.savedClearTimer) clearTimeout(this.savedClearTimer);
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
