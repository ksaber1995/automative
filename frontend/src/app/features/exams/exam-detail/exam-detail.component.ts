import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { cameraScanConfig } from '../../../core/utils/scanner-formats.util';
import { ExamService } from '../services/exam.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { GlobalScanService } from '../../../core/services/global-scan.service';
import { WhatsappTemplatesService } from '../../../core/services/whatsapp-templates.service';
import { openWhatsappChat, renderWhatsappTemplate } from '../../../core/utils/whatsapp.util';
import { ExamModel, ExamResultRow } from '@shared/interfaces/exam.interface';

@Component({
  selector: 'app-exam-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    TableModule,
    TagModule,
    TooltipModule,
    DialogModule,
    TranslateModule,
  ],
  templateUrl: './exam-detail.component.html',
})
export class ExamDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(ExamService);
  private notifications = inject(NotificationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);
  private templatesSvc = inject(WhatsappTemplatesService);
  private globalScan = inject(GlobalScanService);

  // Take over the app-wide (USB/keyboard-wedge) scanner while this page is open,
  // so a scan records the exam grade here instead of falling through to the
  // global "take attendance / open student" flow. A short all-digits value is a
  // student code; anything else is treated as a QR token.
  private readonly scanHandler = (value: string) => this.recordScanned(value);

  examId = '';
  exam = signal<ExamModel | null>(null);
  roster = signal<ExamResultRow[]>([]);
  loading = signal(true);
  savingStatus = signal(false);
  search = signal('');

  // QR scanning
  scannerOpen = signal(false);
  scannerStarting = signal(false);
  // Unified manual entry: a short value (< 6 chars) is treated as a student code,
  // anything longer as a QR token. Routes to record-by-code / record-by-qr.
  manualEntry = signal('');
  resolvingCode = signal(false);
  /** Grade applied to the next scanned/entered student. */
  currentGrade = signal('');
  lastScanResult = signal<{ name: string; grade: string; updated: boolean } | null>(null);

  private readonly SCANNER_ELEMENT_ID = 'exam-qr-scanner-region';
  private html5Qr?: Html5Qrcode;
  private audioCtx?: AudioContext;
  private lastToken = '';
  private lastTokenAt = 0;
  private readonly SCAN_DEDUP_MS = 2500;

  // Per-row debounced auto-save state.
  private rowSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  rowState = signal<Record<string, 'saving' | 'saved' | 'error'>>({});
  private readonly ROW_DEBOUNCE_MS = 600;

  canWrite = computed(() => this.authService.canWrite('academy'));

  filteredRoster = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.roster();
    if (!q) return list;
    return list.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.code != null && String(s.code).toLowerCase().includes(q)));
  });

  gradedCount = computed(() => this.roster().filter((s) => s.grade != null && s.grade !== '').length);
  totalCount = computed(() => this.roster().length);
  isDone = computed(() => this.exam()?.status === 'DONE');

  // ── Send exam results (click-to-chat) ─────────────────────────────────────
  showResultsDialog = signal(false);
  resultsStudents = signal<{
    studentId: string;
    name: string;
    grade: string;
    parentName: string | null;
    parentPhone: string | null;
    studentPhone: string | null;
  }[]>([]);

  ngOnInit() {
    this.examId = this.route.snapshot.paramMap.get('id') || '';
    this.globalScan.register(this.scanHandler);
    this.templatesSvc.load().subscribe({ next: () => {}, error: () => {} });
    if (!this.examId) { this.loading.set(false); return; }
    this.service.getById(this.examId).subscribe({
      next: (e) => this.exam.set(e),
      error: () => { this.notifications.error(this.translate.instant('EXAMS.DETAIL.LOAD_FAILED')); },
    });
    this.loadRoster();
  }

  loadRoster() {
    this.loading.set(true);
    this.service.getResults(this.examId).subscribe({
      next: (rows) => { this.roster.set(rows.map((r) => ({ ...r }))); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  // ── Status toggle ───────────────────────────────────────────────────────────
  toggleStatus() {
    const e = this.exam();
    if (!e) return;
    const next = e.status === 'DONE' ? 'SCHEDULED' : 'DONE';
    this.savingStatus.set(true);
    this.service.update(this.examId, { status: next as any }).subscribe({
      next: (updated) => {
        this.exam.set(updated);
        this.savingStatus.set(false);
        this.notifications.success(this.translate.instant('EXAMS.DETAIL.STATUS_UPDATED'));
      },
      error: () => this.savingStatus.set(false),
    });
  }

  // ── Grade input validation ────────────────────────────────────────────────────
  /**
   * Clamp a numeric grade string to [0, maxGrade]. Returns the raw text for
   * still-incomplete input (e.g. "8.") so decimal entry isn't interrupted; only
   * rewrites the value when it's out of range.
   */
  private clampGrade(value: string): string {
    const v = (value ?? '').trim();
    if (v === '') return '';
    const n = Number(v);
    if (!isFinite(n)) return v; // intermediate state (e.g. "8.") — leave it alone
    if (n < 0) return '0';
    const max = this.exam()?.maxGrade;
    if (max != null && n > max) return String(max);
    return v;
  }

  /** Grade-to-apply field (QR/manual recording). */
  onCurrentGradeInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const clean = this.clampGrade(input.value);
    if (input.value !== clean) input.value = clean;
    this.currentGrade.set(clean);
  }

  // ── Manual per-row grade editing (debounced auto-save) ────────────────────────
  // Typed values are held here (NOT in the roster signal) so each keystroke does
  // not re-render the table and steal focus from the input.
  private pendingGrades = new Map<string, string>();

  onGradeInput(studentId: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const clean = this.clampGrade(input.value);
    if (input.value !== clean) input.value = clean;
    this.pendingGrades.set(studentId, clean);
    this.scheduleRowSave(studentId);
  }

  /** Save immediately on blur (cancels the pending debounce). */
  flushRowSaveNow(studentId: string) {
    if (!this.pendingGrades.has(studentId)) return;
    const existing = this.rowSaveTimers.get(studentId);
    if (existing) { clearTimeout(existing); this.rowSaveTimers.delete(studentId); }
    this.flushRowSave(studentId);
  }

  private setRowState(studentId: string, state: 'saving' | 'saved' | 'error' | null) {
    this.rowState.update((m) => {
      const next = { ...m };
      if (state === null) delete next[studentId]; else next[studentId] = state;
      return next;
    });
  }

  private scheduleRowSave(studentId: string) {
    const existing = this.rowSaveTimers.get(studentId);
    if (existing) clearTimeout(existing);
    this.rowSaveTimers.set(studentId, setTimeout(() => {
      this.rowSaveTimers.delete(studentId);
      this.flushRowSave(studentId);
    }, this.ROW_DEBOUNCE_MS));
  }

  /** Save (or clear, when emptied) a single row. Auto-called after debounce. */
  private flushRowSave(studentId: string) {
    if (!this.pendingGrades.has(studentId)) return;
    const grade = (this.pendingGrades.get(studentId) ?? '').toString().trim();
    this.setRowState(studentId, 'saving');
    const obs = grade
      ? this.service.saveResult(this.examId, studentId, grade)
      : this.service.deleteResult(this.examId, studentId);
    obs.subscribe({
      next: () => {
        this.pendingGrades.delete(studentId);
        // Commit to the signal only after a successful save (avoids re-rendering
        // the table — and stealing input focus — on every keystroke).
        this.roster.update((list) => list.map((s) => (s.studentId === studentId
          ? { ...s, grade, recordedAt: grade ? new Date().toISOString() : null }
          : s)));
        this.setRowState(studentId, 'saved');
        setTimeout(() => this.setRowState(studentId, null), 1500);
      },
      error: () => this.setRowState(studentId, 'error'),
    });
  }

  // ── QR scanning ──────────────────────────────────────────────────────────────
  async openScanner() {
    if (!this.currentGrade().trim()) {
      this.notifications.error(this.translate.instant('EXAMS.DETAIL.ENTER_GRADE_FIRST'));
      return;
    }
    this.scannerOpen.set(true);
    this.lastScanResult.set(null);
    this.ensureAudio();
    setTimeout(() => this.startCamera(), 0);
  }

  closeScanner() {
    this.stopCamera();
    this.scannerOpen.set(false);
  }

  private ensureAudio() {
    if (!this.audioCtx) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (Ctx) this.audioCtx = new Ctx();
    }
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
  }

  private playBeep(ok: boolean) {
    this.ensureAudio();
    const ctx = this.audioCtx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const tones = ok ? [880, 1320] : [300];
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

  private async startCamera() {
    if (this.html5Qr) return;
    this.scannerStarting.set(true);
    try {
      this.html5Qr = new Html5Qrcode(this.SCANNER_ELEMENT_ID);
      await this.html5Qr.start(
        { facingMode: 'environment' },
        cameraScanConfig(Html5QrcodeSupportedFormats),
        (decodedText) => this.handleScan(decodedText),
        () => {},
      );
    } catch {
      this.notifications.error(this.translate.instant('EXAMS.DETAIL.CAMERA_FAILED'));
      this.html5Qr = undefined;
    } finally {
      this.scannerStarting.set(false);
    }
  }

  private stopCamera() {
    const qr = this.html5Qr;
    this.html5Qr = undefined;
    if (!qr) return;
    qr.stop().then(() => qr.clear()).catch(() => {});
  }

  private extractToken(text: string): string {
    const raw = (text || '').trim();
    const marker = '/p/s/';
    const idx = raw.indexOf(marker);
    if (idx >= 0) return raw.slice(idx + marker.length).split(/[/?#]/)[0];
    return raw;
  }

  /**
   * A camera decode — a QR, or a barcode of the student's printed code. The
   * service turns either into a token, so recording below is unchanged.
   */
  private handleScan(decodedText: string) {
    // Dedup on the RAW scan: a camera repeats the same frame, and a barcode must
    // not fire a lookup per frame while the first one is still resolving.
    const raw = (decodedText || '').trim();
    if (!raw) return;
    const now = Date.now();
    if (raw === this.lastToken && now - this.lastTokenAt < this.SCAN_DEDUP_MS) return;
    this.lastToken = raw;
    this.lastTokenAt = now;

    this.globalScan.resolveScan(raw).subscribe({
      next: (token) => { if (token) this.record(token); },
      error: () => this.notifications.error(this.translate.instant('NAV.QR_STUDENT_NOT_FOUND')),
    });
  }

  /**
   * Submit the unified manual-entry field. The value is routed by length:
   * a short value (< 6 chars) is a student code, anything longer a QR token.
   */
  submitManualEntry() {
    const value = this.manualEntry().trim();
    this.manualEntry.set('');
    this.recordScanned(value);
  }

  /**
   * Route a value (manual entry or a scan from the global USB scanner) to the
   * right recorder: a short value (< 6 chars) is a student code; anything
   * longer is treated as a QR token.
   */
  private recordScanned(value: string) {
    const v = (value || '').trim();
    if (!v) return;
    if (v.length < 6) this.recordCode(v);
    else this.record(this.extractToken(v));
  }

  private recordCode(code: string) {
    if (!code) return;
    const grade = this.currentGrade().trim();
    if (!grade) {
      this.notifications.error(this.translate.instant('EXAMS.DETAIL.ENTER_GRADE_FIRST'));
      return;
    }
    this.resolvingCode.set(true);
    this.service.recordByCode(this.examId, code, grade).subscribe({
      next: (res) => {
        this.resolvingCode.set(false);
        const name = `${res.studentName}`;
        this.lastScanResult.set({ name, grade: res.grade, updated: res.alreadyRecorded });
        this.playBeep(true);
        this.roster.update((list) =>
          list.map((s) => (s.studentId === res.studentId
            ? { ...s, grade: res.grade, isAbsent: false, recordedAt: new Date().toISOString() }
            : s)));
        this.notifications.success(
          this.translate.instant(res.alreadyRecorded ? 'EXAMS.DETAIL.GRADE_UPDATED_TOAST' : 'EXAMS.DETAIL.GRADE_RECORDED_TOAST', { name, grade: res.grade }),
        );
      },
      error: () => {
        // Interceptor toasts the translated "no student with this code" message.
        this.resolvingCode.set(false);
        this.playBeep(false);
        this.lastScanResult.set(null);
      },
    });
  }

  private record(token: string) {
    const grade = this.currentGrade().trim();
    if (!grade) {
      this.notifications.error(this.translate.instant('EXAMS.DETAIL.ENTER_GRADE_FIRST'));
      return;
    }
    this.service.recordByQr(this.examId, token, grade).subscribe({
      next: (res) => {
        const name = `${res.studentName}`;
        this.lastScanResult.set({ name, grade: res.grade, updated: res.alreadyRecorded });
        this.playBeep(true);
        // Reflect in the roster.
        this.roster.update((list) =>
          list.map((s) => (s.studentId === res.studentId
            ? { ...s, grade: res.grade, recordedAt: new Date().toISOString() }
            : s)));
        this.notifications.success(
          this.translate.instant(res.alreadyRecorded ? 'EXAMS.DETAIL.GRADE_UPDATED_TOAST' : 'EXAMS.DETAIL.GRADE_RECORDED_TOAST', { name, grade: res.grade }),
        );
      },
      error: () => {
        // Interceptor toasts the translated server error (unknown token / not enrolled).
        this.playBeep(false);
        this.lastScanResult.set(null);
      },
    });
  }

  // ── Send exam results to parents ──────────────────────────────────────────

  openResultsDialog() {
    const graded = this.roster().filter(s => s.grade != null && s.grade !== '');
    if (graded.length === 0) {
      this.notifications.info(this.translate.instant('WHATSAPP.NO_STUDENTS'));
      return;
    }
    this.resultsStudents.set(graded.map(s => ({
      studentId: s.studentId,
      name: s.name,
      grade: s.grade!,
      parentName: s.parentName ?? null,
      parentPhone: s.parentPhone ?? null,
      studentPhone: s.studentPhone ?? null,
    })));
    this.showResultsDialog.set(true);
  }

  /** Open a pre-filled WhatsApp chat with one student's parent (click-to-chat). */
  sendExamResult(row: {
    name: string;
    grade: string;
    parentName: string | null;
    parentPhone: string | null;
    studentPhone: string | null;
  }) {
    const e = this.exam();
    if (!e) return;
    const maxGrade = e.maxGrade ?? 0;
    const gradeNum = parseFloat(row.grade);
    const percentage = maxGrade > 0 ? Math.round((gradeNum / maxGrade) * 100) : 0;
    const text = renderWhatsappTemplate(this.templatesSvc.get('EXAM_RESULTS'), {
      studentName: row.name,
      parentName: row.parentName || row.name,
      academyName: this.authService.getCompanyName(),
      examName: e.name,
      grade: row.grade,
      maxGrade: String(maxGrade),
      percentage: String(percentage),
      courseName: e.courseName ?? '',
    });
    const ok = openWhatsappChat(row.parentPhone || row.studentPhone, text);
    if (!ok) this.notifications.info(this.translate.instant('WHATSAPP.NO_PHONE'));
  }

  // ── Absence ───────────────────────────────────────────────────────────────
  /** Toggle a student's exam absence. Absent clears any grade; un-absent un-records. */
  toggleAbsent(row: ExamResultRow) {
    const absent = !row.isAbsent;
    this.setRowState(row.studentId, 'saving');
    this.service.markAbsent(this.examId, row.studentId, absent).subscribe({
      next: () => {
        this.roster.update((list) => list.map((s) => (s.studentId === row.studentId
          ? { ...s, isAbsent: absent, grade: absent ? null : null, recordedAt: absent ? new Date().toISOString() : null }
          : s)));
        this.pendingGrades.delete(row.studentId);
        this.setRowState(row.studentId, 'saved');
        setTimeout(() => this.setRowState(row.studentId, null), 1500);
      },
      error: () => this.setRowState(row.studentId, 'error'),
    });
  }

  // ── Mark all remaining (ungraded, not-yet-absent) students absent ───────────
  markingAbsent = signal(false);

  markRemainingAbsent() {
    this.markingAbsent.set(true);
    this.service.markRemainingAbsent(this.examId).subscribe({
      next: (res) => {
        this.markingAbsent.set(false);
        this.notifications.success(this.translate.instant('EXAMS.DETAIL.MARKED_ABSENT_COUNT', { count: res.count }));
        this.loadRoster();
      },
      error: () => this.markingAbsent.set(false),
    });
  }

  // ── Send results via Telegram ───────────────────────────────────────────────
  sendingTelegram = signal(false);

  sendResultsViaTelegram() {
    this.sendingTelegram.set(true);
    this.service.sendTelegramResults(this.examId).subscribe({
      next: (res) => {
        this.sendingTelegram.set(false);
        this.notifications.success(this.translate.instant('EXAMS.DETAIL.TELEGRAM_SENT', { count: res.sent }));
      },
      error: () => {
        // Interceptor toasts the translated error (e.g. Telegram not configured).
        this.sendingTelegram.set(false);
      },
    });
  }

  edit() { this.router.navigate(['/exams', this.examId, 'edit']); }
  back() { this.router.navigate(['/exams']); }

  ngOnDestroy() {
    this.globalScan.unregister(this.scanHandler);
    this.stopCamera();
    this.audioCtx?.close().catch(() => {});
    this.rowSaveTimers.forEach((t) => clearTimeout(t));
    this.rowSaveTimers.clear();
  }
}
