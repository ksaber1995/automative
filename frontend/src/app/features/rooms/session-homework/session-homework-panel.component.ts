import { Component, OnDestroy, effect, inject, input, model, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ExamService } from '../../exams/services/exam.service';
import { HOMEWORK_RATINGS, HOMEWORK_RATING_MAX, ratingLabelKey } from '../../exams/homework-rating.util';
import { CompanyService } from '../../../core/services/company.service';
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
 * Either kind can be created here: the same table stores both, and a teacher
 * sitting in a session marks a quiz the same way they mark homework. The picker
 * lists both for this class — course-wide exams have no class_id and stay out.
 *
 * Two steps: pick an existing item for the class (or create one), then record.
 * Scans are NOT registered with GlobalScanService here — the attendance page owns
 * that single handler and forwards to `handleScan()` while this card is open,
 * which avoids the two of them fighting over it.
 */
@Component({
  selector: 'app-session-homework-panel',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, CardModule, ButtonModule,
    InputTextModule, SelectModule, TableModule, TagModule, TooltipModule, TranslateModule,
  ],
  templateUrl: './session-homework-panel.component.html',
})
export class SessionHomeworkPanelComponent implements OnDestroy {
  private service = inject(ExamService);
  private companyService = inject(CompanyService);
  private notifications = inject(NotificationService);
  private translate = inject(TranslateService);
  private confirmationService = inject(ConfirmationService);

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
  deletingId = signal<string | null>(null);

  // New homework / exam form.
  newName = signal('');
  newMax = signal<number | null>(10);
  /** Which kind is being created. Homework is the common case, so it leads. */
  newIsHomework = signal(true);
  /**
   * The last name this panel generated. Used to tell an untouched field from one
   * the teacher typed into, so switching the type renames the former and leaves
   * the latter alone.
   */
  private autoName = '';

  typeOptions = computed(() => [
    { label: this.translate.instant('SESSION_HOMEWORK.TYPE_HOMEWORK'), value: true },
    { label: this.translate.instant('SESSION_HOMEWORK.TYPE_EXAM'), value: false },
  ]);

  // ── Rating mode (company setting) ─────────────────────────────────────────
  /** The company marks by rating rather than by number. */
  ratingMode = signal(false);
  ratingMax = HOMEWORK_RATING_MAX;

  ratingOptions = computed(() =>
    HOMEWORK_RATINGS.map((r) => ({ label: this.translate.instant(r.labelKey), value: String(r.value) })));

  /**
   * Whether THIS item is marked by rating. The company setting alone isn't
   * enough: a homework created earlier out of 10 keeps its number box, because
   * relabelling a 7 as a rating would invent a meaning the teacher never gave it.
   * Everything created while the setting is on is out of 5, so it qualifies.
   */
  useRating = computed(() => this.ratingMode() && this.active()?.maxGrade === HOMEWORK_RATING_MAX);

  /** The label for a stored mark, or '' when it isn't one of the five. */
  ratingLabel(grade: string | number | null | undefined): string {
    const key = ratingLabelKey(grade);
    return key ? this.translate.instant(key) : '';
  }

  setType(isHomework: boolean): void {
    this.newIsHomework.set(isHomework);
    // Only re-seed a name the teacher hasn't edited.
    if (this.newName() === this.autoName) this.seedName();
  }

  /** "Homework 3" / "Exam 2" — numbered within its own kind, not the whole list. */
  private seedName(): void {
    const isHw = this.newIsHomework();
    const n = this.homeworks().filter((x) => x.isHomework === isHw).length + 1;
    const label = this.translate.instant(
      isHw ? 'SESSION_HOMEWORK.DEFAULT_NAME' : 'SESSION_HOMEWORK.DEFAULT_NAME_EXAM', { n },
    );
    this.autoName = label;
    this.newName.set(label);
  }

  // Active homework + its roster.
  active = signal<ExamModel | null>(null);
  roster = signal<ExamResultRow[]>([]);
  loadingRoster = signal(false);
  search = signal('');

  /** Mark applied to the next scanned/typed student. */
  currentGrade = signal('');
  lastScanResult = signal<{ name: string; grade: string; updated: boolean } | null>(null);

  manualEntry = signal('');
  resolvingCode = signal(false);

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
      s.name.toLowerCase().includes(q) ||
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
      }
    });

    // Which marking control to show. Read once — an admin changing it mid-session
    // is not worth a request every time this panel opens, and it takes effect on
    // the next page load.
    this.companyService.getSettings().subscribe({
      next: (s) => {
        this.ratingMode.set(s.homeworkGradingMode === 'RATING');
        if (this.ratingMode()) this.newMax.set(HOMEWORK_RATING_MAX);
      },
      error: () => {}, // stay on the number box if settings can't be read
    });
  }

  ngOnDestroy(): void {
    this.rowSaveTimers.forEach((t) => clearTimeout(t));
  }

  // ── Step 1: pick or create ────────────────────────────────────────────────
  private loadList(): void {
    this.loadingList.set(true);
    this.service.getForClass(this.classId()).subscribe({
      next: (rows) => {
        this.homeworks.set(rows);
        this.loadingList.set(false);
        this.seedName();
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
      // In rating mode the max is the scale itself, not the teacher's choice —
      // that is what makes a stored 4 always read back as "Very good".
      maxGrade: this.ratingMode() ? HOMEWORK_RATING_MAX : this.newMax(),
      isHomework: this.newIsHomework(),
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
    this.step.set('pick');
    this.loadList();
  }

  /**
   * Delete a homework from the picker. The API soft-deletes (is_active = false)
   * and the list filters on it, so the row disappears and recorded marks stay on
   * the row rather than being destroyed.
   *
   * Confirmed first, and the message names how many marks are already recorded —
   * deleting a homework that has been marked is the one that actually costs
   * someone work.
   */
  remove(hw: ExamModel): void {
    const marked = hw.resultCount ?? 0;
    this.confirmationService.confirm({
      header: this.translate.instant('SESSION_HOMEWORK.DELETE_HEADER'),
      message: marked > 0
        ? this.translate.instant('SESSION_HOMEWORK.DELETE_CONFIRM_MARKED', { name: hw.name, n: marked })
        : this.translate.instant('SESSION_HOMEWORK.DELETE_CONFIRM', { name: hw.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.deletingId.set(hw.id);
        this.service.delete(hw.id).subscribe({
          next: () => {
            this.deletingId.set(null);
            this.notifications.success(this.translate.instant('SESSION_HOMEWORK.DELETED', { name: hw.name }));
            // If the deleted one was open, step 2 would be pointing at a dead
            // record — drop back to the picker.
            if (this.active()?.id === hw.id) {
              this.active.set(null);
              this.step.set('pick');
            }
            this.loadList();
          },
          error: () => this.deletingId.set(null), // interceptor toasts the server error
        });
      },
    });
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
  /**
   * A mark comes off an <input type="number">, so ngModel hands back a NUMBER (or
   * null when the box is empty) — not a string. Everything downstream treats a mark
   * as text (.trim(), string compare, the API payload), so it is normalised here at
   * the boundary rather than defended against at each call site.
   */
  private asMark(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
  }

  /** The mark applied to the next scan, always as text. */
  setCurrentGrade(value: unknown): void {
    this.currentGrade.set(this.asMark(value));
  }

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
      next: (res) => this.afterRecord(`${res.studentName}`, res.grade, res.alreadyRecorded),
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
        this.afterRecord(`${res.studentName}`, res.grade, res.alreadyRecorded);
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
  onGradeInput(row: ExamResultRow, value: unknown): void {
    const hw = this.active();
    if (!hw) return;
    // Don't clamp mid-typing: rewriting the value under the caret is what makes an
    // input fight the user. It's clamped once, on save.
    const raw = this.asMark(value);
    this.grades.update((g) => ({ ...g, [row.studentId]: raw }));

    const existing = this.rowSaveTimers.get(row.studentId);
    if (existing) clearTimeout(existing);
    this.rowSaveTimers.set(row.studentId, setTimeout(() => this.flushRowSave(row.studentId, raw), this.ROW_DEBOUNCE_MS));
  }

  /**
   * A rating is picked, not typed, so it saves at once — there is no half-typed
   * state to wait out. Clearing the dropdown removes the mark, same as emptying
   * the number box.
   */
  onRatingPick(row: ExamResultRow, value: string | null): void {
    const raw = value ?? '';
    this.grades.update((g) => ({ ...g, [row.studentId]: raw }));
    const pending = this.rowSaveTimers.get(row.studentId);
    if (pending) {
      clearTimeout(pending);
      this.rowSaveTimers.delete(row.studentId);
    }
    this.flushRowSave(row.studentId, raw);
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
    this.visible.set(false);
  }
}
