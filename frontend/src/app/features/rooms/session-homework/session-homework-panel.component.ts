import { Component, OnDestroy, effect, inject, input, model, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Html5Qrcode } from 'html5-qrcode';
import { ExamService } from '../../exams/services/exam.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ExamModel, ExamResultRow } from '@shared/interfaces/exam.interface';

/**
 * Record homework marks from a session — an inline card on the attendance page,
 * sitting with the other cards rather than trapping the teacher in a modal: the
 * roster stays visible behind it and scanning a queue of students is the main job
 * here, so it wants room.
 *
 * Homework rides on the exams table (isHomework), so this reuses the exam
 * recording endpoints wholesale — record-by-qr, record-by-code and the per-student
 * upsert. A homework carries a classId, so the roster the API returns is already
 * narrowed to this class.
 *
 * Two steps: pick an existing homework for the class (or create one), then record.
 * Scans are NOT registered with GlobalScanService here — the attendance page owns
 * that single handler and forwards to `handleScan()` while this card is open,
 * which avoids the two of them fighting over it.
 */
@Component({
  selector: 'app-session-homework-panel',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, CardModule, ButtonModule,
    InputTextModule, TableModule, TooltipModule, TranslateModule,
  ],
  templateUrl: './session-homework-panel.component.html',
})
export class SessionHomeworkPanelComponent implements OnDestroy {
  private service = inject(ExamService);
  private notifications = inject(NotificationService);
  private translate = inject(TranslateService);

  /** Open/closed, owned by the attendance page (its Homework button toggles it). */
  visible = model<boolean>(false);
  sessionId = input.required<string>();
  classId = input.required<string>();
  /** Seeds the default homework title, e.g. "Homework — Algebra 101". */
  className = input<string>('');

  /** Step 1 = pick or create, step 2 = record marks. */
  step = signal<'pick' | 'record'>('pick');
  homeworks = signal<ExamModel[]>([]);
  loadingList = signal(false);
  creating = signal(false);

  // New-homework form.
  newName = signal('');
  newMax = signal<number | null>(10);

  // Active homework + its roster.
  active = signal<ExamModel | null>(null);
  roster = signal<ExamResultRow[]>([]);
  loadingRoster = signal(false);
  search = signal('');

  /** Mark applied to the next scanned/typed student. */
  currentGrade = signal('');
  lastScanResult = signal<{ name: string; grade: string; updated: boolean } | null>(null);

  scannerOpen = signal(false);
  scannerStarting = signal(false);
  manualEntry = signal('');
  resolvingCode = signal(false);

  private readonly SCANNER_ELEMENT_ID = 'homework-qr-scanner-region';
  private html5Qr?: Html5Qrcode;
  private lastToken = '';
  private lastTokenAt = 0;
  private readonly SCAN_DEDUP_MS = 2500;

  private rowSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  rowState = signal<Record<string, 'saving' | 'saved' | 'error'>>({});
  private readonly ROW_DEBOUNCE_MS = 600;

  /**
   * The marks currently in the roster's input boxes, keyed by student.
   *
   * Typing MUST NOT touch `roster` — rebuilding that array re-creates the table
   * rows, which destroys the very <input> being typed in: focus is lost after the
   * first digit and the row's spinner is left hanging on a dead element. Keeping
   * the edits here leaves the row objects untouched, so the input survives.
   */
  grades = signal<Record<string, string>>({});

  filteredRoster = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.roster();
    if (!q) return list;
    return list.filter((s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
      (s.code != null && String(s.code).toLowerCase().includes(q)));
  });

  markedCount = computed(() => {
    const g = this.grades();
    return this.roster().filter((s) => (g[s.studentId] ?? '') !== '').length;
  });

  /** Rows are identified by student, so PrimeNG reuses them instead of re-creating. */
  trackByStudent = (_: number, row: ExamResultRow) => row.studentId;

  constructor() {
    // Re-open always lands on the picker with a fresh list, so a homework created
    // in a previous visit shows up instead of a stale one being re-marked.
    effect(() => {
      if (this.visible()) {
        this.step.set('pick');
        this.active.set(null);
        this.loadList();
      } else {
        this.stopCamera();
      }
    });
  }

  ngOnDestroy(): void {
    this.stopCamera();
    this.rowSaveTimers.forEach((t) => clearTimeout(t));
  }

  // ── Step 1: pick or create ────────────────────────────────────────────────
  private loadList(): void {
    this.loadingList.set(true);
    this.service.getHomeworkForClass(this.classId()).subscribe({
      next: (rows) => {
        this.homeworks.set(rows);
        this.loadingList.set(false);
        const label = this.translate.instant('SESSION_HOMEWORK.DEFAULT_NAME', { n: rows.length + 1 });
        this.newName.set(label);
      },
      error: () => this.loadingList.set(false),
    });
  }

  create(): void {
    const name = this.newName().trim();
    if (!name) {
      this.notifications.error(this.translate.instant('SESSION_HOMEWORK.NAME_REQUIRED'));
      return;
    }
    this.creating.set(true);
    // examDate is the local day — a homework marked tonight belongs to today, not
    // to whatever UTC says it is.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    this.service.create({
      name,
      examDate: today,
      maxGrade: this.newMax(),
      isHomework: true,
      classId: this.classId(),
      sessionId: this.sessionId(),
      status: 'DONE',
    }).subscribe({
      next: (hw) => {
        this.creating.set(false);
        this.open(hw);
      },
      error: () => this.creating.set(false), // interceptor toasts the server error
    });
  }

  /** Move to the recording step for a homework. */
  open(hw: ExamModel): void {
    this.active.set(hw);
    this.step.set('record');
    this.currentGrade.set('');
    this.lastScanResult.set(null);
    this.loadRoster();
  }

  back(): void {
    this.stopCamera();
    this.step.set('pick');
    this.loadList();
  }

  private loadRoster(): void {
    const hw = this.active();
    if (!hw) return;
    this.loadingRoster.set(true);
    this.service.getResults(hw.id).subscribe({
      next: (rows) => {
        this.roster.set(rows);
        this.grades.set(Object.fromEntries(rows.map((r) => [r.studentId, r.grade ?? ''])));
        this.loadingRoster.set(false);
      },
      error: () => this.loadingRoster.set(false),
    });
  }

  // ── Step 2: record ────────────────────────────────────────────────────────
  /** Clamp to the homework's max so a typo can't store 100 out of 10. */
  private clampGrade(value: string): string {
    const max = this.active()?.maxGrade;
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return value;
    if (n < 0) return '0';
    if (max != null && n > max) return String(max);
    return value;
  }

  /**
   * Called by the attendance page's global-scan handler while this dialog is open,
   * and by the manual-entry box. A short all-digits value is a student code;
   * anything longer is a QR token.
   */
  handleScan(value: string): void {
    const v = (value || '').trim();
    if (!v) return;
    if (!this.currentGrade().trim()) {
      this.notifications.error(this.translate.instant('SESSION_HOMEWORK.ENTER_MARK_FIRST'));
      return;
    }
    if (/^\d+$/.test(v) && v.length < 6) this.recordCode(v);
    else this.record(this.extractToken(v));
  }

  submitManualEntry(): void {
    const value = this.manualEntry().trim();
    this.manualEntry.set('');
    this.handleScan(value);
  }

  private extractToken(text: string): string {
    const raw = (text || '').trim();
    const marker = '/p/s/';
    const idx = raw.indexOf(marker);
    if (idx >= 0) return raw.slice(idx + marker.length).split(/[/?#]/)[0];
    return raw;
  }

  private record(token: string): void {
    const hw = this.active();
    if (!hw || !token) return;
    const grade = this.clampGrade(this.currentGrade().trim());
    this.service.recordByQr(hw.id, token, grade).subscribe({
      next: (res) => this.afterRecord(`${res.studentFirstName} ${res.studentLastName}`, res.grade, res.alreadyRecorded),
      error: () => this.lastScanResult.set(null), // interceptor toasts the server error
    });
  }

  private recordCode(code: string): void {
    const hw = this.active();
    if (!hw) return;
    const grade = this.clampGrade(this.currentGrade().trim());
    this.resolvingCode.set(true);
    this.service.recordByCode(hw.id, code, grade).subscribe({
      next: (res) => {
        this.resolvingCode.set(false);
        this.afterRecord(`${res.studentFirstName} ${res.studentLastName}`, res.grade, res.alreadyRecorded);
      },
      error: () => { this.resolvingCode.set(false); this.lastScanResult.set(null); },
    });
  }

  private afterRecord(name: string, grade: string, updated: boolean): void {
    this.lastScanResult.set({ name, grade, updated });
    this.beep(updated);
    this.notifications.success(this.translate.instant(
      updated ? 'SESSION_HOMEWORK.MARK_UPDATED' : 'SESSION_HOMEWORK.MARK_RECORDED', { name, grade },
    ));
    this.loadRoster();
  }

  // ── Roster inline entry (no camera) ───────────────────────────────────────
  onGradeInput(row: ExamResultRow, value: string): void {
    const hw = this.active();
    if (!hw) return;
    // Don't clamp mid-typing: rewriting the value under the caret is what makes an
    // input fight the user. It's clamped once, on save.
    const raw = value ?? '';
    this.grades.update((g) => ({ ...g, [row.studentId]: raw }));

    const existing = this.rowSaveTimers.get(row.studentId);
    if (existing) clearTimeout(existing);
    this.rowSaveTimers.set(row.studentId, setTimeout(() => this.flushRowSave(row.studentId, raw), this.ROW_DEBOUNCE_MS));
  }

  /** Enter / leaving the box saves straight away instead of waiting out the debounce. */
  flushNow(row: ExamResultRow): void {
    const timer = this.rowSaveTimers.get(row.studentId);
    if (!timer) return;               // nothing pending — already saved
    clearTimeout(timer);
    this.rowSaveTimers.delete(row.studentId);
    this.flushRowSave(row.studentId, this.grades()[row.studentId] ?? '');
  }

  private flushRowSave(studentId: string, grade: string): void {
    const hw = this.active();
    if (!hw) return;
    this.rowSaveTimers.delete(studentId);
    this.rowState.update((s) => ({ ...s, [studentId]: 'saving' }));

    const done = (state: 'saved' | 'error') => this.rowState.update((s) => ({ ...s, [studentId]: state }));
    // Clamp here, not while typing — 12 in a /10 homework becomes 10 on save.
    const value = this.clampGrade((grade ?? '').trim()).trim();
    if (value !== (grade ?? '').trim()) {
      this.grades.update((g) => ({ ...g, [studentId]: value }));
    }

    // Clearing the box removes the mark rather than storing an empty one.
    const call = value
      ? this.service.saveResult(hw.id, studentId, value)
      : this.service.deleteResult(hw.id, studentId);

    call.subscribe({
      next: () => {
        done('saved');
        // Keep the row in step with what's stored, so markedCount and a later
        // reload agree — but only now, when the user has stopped typing.
        this.roster.update((list) =>
          list.map((r) => (r.studentId === studentId ? { ...r, grade: value || null } : r)));
      },
      error: () => done('error'),
    });
  }

  // ── Camera ────────────────────────────────────────────────────────────────
  async openScanner(): Promise<void> {
    if (!this.currentGrade().trim()) {
      this.notifications.error(this.translate.instant('SESSION_HOMEWORK.ENTER_MARK_FIRST'));
      return;
    }
    this.scannerOpen.set(true);
    setTimeout(() => this.startCamera(), 0); // wait for the region to exist
  }

  async startCamera(): Promise<void> {
    if (this.html5Qr) return;
    this.scannerStarting.set(true);
    try {
      this.html5Qr = new Html5Qrcode(this.SCANNER_ELEMENT_ID);
      await this.html5Qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => this.onDecoded(decodedText),
        () => {}, // per-frame decode misses are normal
      );
    } catch {
      this.notifications.error(this.translate.instant('SESSION_HOMEWORK.CAMERA_FAILED'));
      this.html5Qr = undefined;
    } finally {
      this.scannerStarting.set(false);
    }
  }

  private onDecoded(decodedText: string): void {
    // One physical card lingers in frame for many frames — ignore repeats.
    const token = this.extractToken(decodedText);
    const now = Date.now();
    if (token === this.lastToken && now - this.lastTokenAt < this.SCAN_DEDUP_MS) return;
    this.lastToken = token;
    this.lastTokenAt = now;
    this.handleScan(token);
  }

  closeScanner(): void {
    this.stopCamera();
    this.scannerOpen.set(false);
  }

  private stopCamera(): void {
    const qr = this.html5Qr;
    this.html5Qr = undefined;
    if (!qr) return;
    qr.stop().then(() => qr.clear()).catch(() => {});
  }

  private beep(lower: boolean): void {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = lower ? 520 : 880;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // Audio is a nicety — a blocked AudioContext must never break recording.
    }
  }

  close(): void {
    this.stopCamera();
    this.visible.set(false);
  }
}
