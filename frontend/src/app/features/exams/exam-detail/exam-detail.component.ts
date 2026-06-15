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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Html5Qrcode } from 'html5-qrcode';
import { ExamService } from '../services/exam.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
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

  examId = '';
  exam = signal<ExamModel | null>(null);
  roster = signal<ExamResultRow[]>([]);
  loading = signal(true);
  savingStatus = signal(false);
  search = signal('');

  // QR scanning
  scannerOpen = signal(false);
  scannerStarting = signal(false);
  manualToken = signal('');
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
    return list.filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q));
  });

  gradedCount = computed(() => this.roster().filter((s) => s.grade != null && s.grade !== '').length);
  totalCount = computed(() => this.roster().length);
  isDone = computed(() => this.exam()?.status === 'DONE');

  ngOnInit() {
    this.examId = this.route.snapshot.paramMap.get('id') || '';
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

  // ── Manual per-row grade editing (debounced auto-save) ────────────────────────
  setRowGrade(studentId: string, grade: string) {
    this.roster.update((list) => list.map((s) => (s.studentId === studentId ? { ...s, grade } : s)));
    this.scheduleRowSave(studentId);
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
    const row = this.roster().find((s) => s.studentId === studentId);
    if (!row) return;
    const grade = (row.grade ?? '').toString().trim();
    this.setRowState(studentId, 'saving');
    const obs = grade
      ? this.service.saveResult(this.examId, studentId, grade)
      : this.service.deleteResult(this.examId, studentId);
    obs.subscribe({
      next: () => {
        this.roster.update((list) => list.map((s) => (s.studentId === studentId
          ? { ...s, recordedAt: grade ? new Date().toISOString() : null }
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
        { fps: 10, qrbox: { width: 220, height: 220 } },
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

  private handleScan(decodedText: string) {
    const token = this.extractToken(decodedText);
    if (!token) return;
    const now = Date.now();
    if (token === this.lastToken && now - this.lastTokenAt < this.SCAN_DEDUP_MS) return;
    this.lastToken = token;
    this.lastTokenAt = now;
    this.record(token);
  }

  submitManualToken() {
    const token = this.extractToken(this.manualToken());
    this.manualToken.set('');
    if (!token) return;
    this.record(token);
  }

  private record(token: string) {
    const grade = this.currentGrade().trim();
    if (!grade) {
      this.notifications.error(this.translate.instant('EXAMS.DETAIL.ENTER_GRADE_FIRST'));
      return;
    }
    this.service.recordByQr(this.examId, token, grade).subscribe({
      next: (res) => {
        const name = `${res.studentFirstName} ${res.studentLastName}`;
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

  edit() { this.router.navigate(['/exams', this.examId, 'edit']); }
  back() { this.router.navigate(['/exams']); }

  ngOnDestroy() {
    this.stopCamera();
    this.audioCtx?.close().catch(() => {});
    this.rowSaveTimers.forEach((t) => clearTimeout(t));
    this.rowSaveTimers.clear();
  }
}
