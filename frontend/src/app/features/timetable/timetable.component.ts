import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { TimetableService, TimetableEntry } from './timetable.service';
import { LookupService, LookupOption } from '../../core/services/lookup.service';
import { CourseService } from '../courses/services/course.service';
import { EmployeeService } from '../employees/services/employee.service';
import { LanguageService } from '../../core/services/language.service';
import { AuthService } from '../../core/services/auth.service';

interface PositionedEntry extends TimetableEntry {
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
}

/** One column of the week strip: its date, plus that day's laid-out classes. */
interface WeekColumn {
  date: Date;
  iso: string;
  entries: TimetableEntry[];
}

type ViewMode = 'DAY' | 'WEEK';
type Layout = 'GRID' | 'STACKED';

/**
 * The week runs Saturday → Friday here, not Monday → Sunday: these are Egyptian
 * academies, whose teaching week starts on Saturday. `Date#getDay()` numbering,
 * so 6 = Saturday.
 */
const WEEK_START_DOW = 6;

const HOUR_HEIGHT_PX = 60; // 1 hour = 60px
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 23;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);

const PALETTE = [
  { bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-900', accent: 'bg-indigo-500' },
  { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-900', accent: 'bg-emerald-500' },
  { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-900', accent: 'bg-amber-500' },
  { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-900', accent: 'bg-rose-500' },
  { bg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-900', accent: 'bg-sky-500' },
  { bg: 'bg-violet-50', border: 'border-violet-300', text: 'text-violet-900', accent: 'bg-violet-500' },
  { bg: 'bg-teal-50', border: 'border-teal-300', text: 'text-teal-900', accent: 'bg-teal-500' },
  { bg: 'bg-fuchsia-50', border: 'border-fuchsia-300', text: 'text-fuchsia-900', accent: 'bg-fuchsia-500' },
];

function colorForCourse(courseId: string | null): typeof PALETTE[number] {
  if (!courseId) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < courseId.length; i++) hash = (hash * 31 + courseId.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function parseHHMM(time: string | null): { h: number; m: number } | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return { h, m };
}

function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Midnight on the Saturday that opens the week `d` falls in. */
function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 7 - WEEK_START_DOW) % 7));
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Place one day's classes on the hour grid: vertical position from the times, and
 * side-by-side columns for classes that overlap. Shared by the day view and by
 * every column of the week view, so a busy Sunday looks the same in both.
 */
function layoutEntries(entries: TimetableEntry[], totalGridHeight: number): PositionedEntry[] {
  if (entries.length === 0) return [];

  const sized = entries
    .map((e) => {
      const start = parseHHMM(e.startTime);
      const end = parseHHMM(e.endTime);
      if (!start || !end) return null;

      const startMinutes = (start.h - DAY_START_HOUR) * 60 + start.m;
      const endMinutes = (end.h - DAY_START_HOUR) * 60 + end.m;

      const clampedStart = Math.max(0, startMinutes);
      const clampedEnd = Math.min(totalGridHeight / (HOUR_HEIGHT_PX / 60), endMinutes);

      const topPx = (clampedStart / 60) * HOUR_HEIGHT_PX;
      const heightPx = Math.max(28, ((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT_PX);

      return {
        ...e,
        topPx,
        heightPx,
        // computed below
        leftPct: 0,
        widthPct: 100,
        _startMin: startMinutes,
        _endMin: endMinutes,
      } as PositionedEntry & { _startMin: number; _endMin: number };
    })
    .filter((e): e is PositionedEntry & { _startMin: number; _endMin: number } => !!e);

  // Lay out overlapping entries side-by-side using a simple sweep algorithm
  sized.sort((a, b) => a._startMin - b._startMin || b._endMin - a._endMin);

  type Group = { items: typeof sized; columns: { endMin: number }[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let currentMaxEnd = -Infinity;

  for (const item of sized) {
    if (!current || item._startMin >= currentMaxEnd) {
      current = { items: [], columns: [] };
      groups.push(current);
      currentMaxEnd = -Infinity;
    }
    current.items.push(item);
    currentMaxEnd = Math.max(currentMaxEnd, item._endMin);
  }

  for (const group of groups) {
    const columns: { endMin: number }[] = [];
    const colByItem = new Map<typeof sized[number], number>();
    for (const item of group.items) {
      let placedCol = -1;
      for (let c = 0; c < columns.length; c++) {
        if (item._startMin >= columns[c].endMin) {
          placedCol = c;
          columns[c].endMin = item._endMin;
          break;
        }
      }
      if (placedCol === -1) {
        placedCol = columns.length;
        columns.push({ endMin: item._endMin });
      }
      colByItem.set(item, placedCol);
    }
    const totalCols = columns.length;
    for (const item of group.items) {
      const col = colByItem.get(item)!;
      item.leftPct = (col / totalCols) * 100;
      item.widthPct = (1 / totalCols) * 100;
    }
  }

  return sized.map(({ _startMin, _endMin, ...rest }) => rest);
}

@Component({
  selector: 'app-timetable',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    DialogModule,
    TagModule,
    TooltipModule,
    TranslateModule,
  ],
  templateUrl: './timetable.component.html',
  styleUrl: './timetable.component.scss'})
export class TimetableComponent implements OnInit {
  private router = inject(Router);
  private timetableService = inject(TimetableService);
  private lookupService = inject(LookupService);
  private courseService = inject(CourseService);
  private employeeService = inject(EmployeeService);
  languageService = inject(LanguageService);
  authService = inject(AuthService);

  hours = HOURS;
  hourHeight = HOUR_HEIGHT_PX;
  dayStartHour = DAY_START_HOUR;
  totalGridHeight = (DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_HEIGHT_PX;

  // A signal, not a plain field: every label and stat below is a computed(), and a
  // plain field would leave them showing the date the page opened with.
  selectedDate = signal<Date>(new Date());
  // Opens on the week: the whole schedule at a glance is what people come here
  // for. The Day toggle is one click away for a single day's detail.
  viewMode = signal<ViewMode>('WEEK');
  // GRID = hour × day counts; STACKED = each day listed under the previous one.
  layout = signal<Layout>('GRID');
  selectedBranchId: string | null = null;
  selectedTeacherId: string | null = null;
  selectedCourseId: string | null = null;
  selectedRoomId: string | null = null;

  loading = signal(false);
  entries = signal<TimetableEntry[]>([]);
  weekColumns = signal<WeekColumn[]>([]);
  branches = signal<LookupOption[]>([]);
  rooms = signal<LookupOption[]>([]);
  teachers = signal<any[]>([]);
  courses = signal<any[]>([]);

  dayOfWeek = signal<string>('');

  // "What's behind this number" dialog.
  dialogVisible = signal(false);
  dialogTitle = signal('');
  dialogEntries = signal<TimetableEntry[]>([]);

  /** ticking signal for the now-line, refreshed every minute */
  nowTick = signal<number>(Date.now());

  isWeek = computed(() => this.viewMode() === 'WEEK');

  filteredEntries = computed(() => this.entries());

  /** Everything on screen right now — one day's classes, or the whole week's. */
  visibleEntries = computed<TimetableEntry[]>(() =>
    this.isWeek()
      ? this.weekColumns().flatMap((c) => c.entries)
      : this.filteredEntries()
  );

  inProgressCount = computed(() =>
    this.visibleEntries().filter((e) => e.isInProgress).length
  );

  totalStudents = computed(() =>
    this.visibleEntries().reduce((sum, e) => sum + (e.studentCount || 0), 0)
  );

  /** The seven Saturday→Friday dates of the week `selectedDate` falls in. */
  weekDates = computed<Date[]>(() => {
    const start = startOfWeek(this.selectedDate());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  });

  /** The week's days with their entries sorted by start time, today flagged. */
  weekDays = computed(() =>
    this.weekColumns().map((col) => ({
      ...col,
      isToday: isSameDay(col.date, new Date(this.nowTick())),
      label: this.columnLabel(col.date),
      longLabel: this.longDayLabel(col.date),
      entries: [...col.entries].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')),
    }))
  );

  /**
   * The week as counts, not cards. An academy runs dozens of classes a day across
   * rooms and teachers — drawn as positioned blocks in a 120px column they are an
   * unreadable mosaic. Each cell is "how many classes start in this hour on this
   * day"; the number opens the list. Hours with nothing all week are dropped, so a
   * school that only teaches 4pm-9pm gets five rows, not seventeen.
   */
  weekGridRows = computed(() => {
    const days = this.weekDays();
    return this.hours
      .map((hour) => ({
        hour,
        label: this.formatHour(hour),
        cells: days.map((d) => ({
          iso: d.iso,
          date: d.date,
          isToday: d.isToday,
          entries: d.entries.filter((e) => {
            const start = parseHHMM(e.startTime);
            return !!start && start.h === hour;
          }),
        })),
      }))
      .filter((row) => row.cells.some((c) => c.entries.length > 0));
  });

  positionedEntries = computed<PositionedEntry[]>(() =>
    layoutEntries(this.filteredEntries(), this.totalGridHeight)
  );

  /** The day's classes in time order — what the stacked day layout lists. */
  sortedDayEntries = computed(() =>
    [...this.filteredEntries()].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
  );

  hasActiveFilters = computed(() =>
    !!this.selectedBranchId || !!this.selectedTeacherId || !!this.selectedCourseId || !!this.selectedRoomId
  );

  formattedDateLabel = computed(() => {
    if (this.isWeek()) return this.weekRangeLabel();
    return this.selectedDate().toLocaleDateString(this.localeTag(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  });

  dayOfWeekLabel = computed(() =>
    this.selectedDate().toLocaleDateString(this.localeTag(), { weekday: 'long' })
  );

  /** "Sat 12 – Fri 18 July 2026", collapsing the month when both ends share it. */
  weekRangeLabel = computed(() => {
    const days = this.weekDates();
    const [first, last] = [days[0], days[6]];
    const locale = this.localeTag();
    const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
    const from = first.toLocaleDateString(locale, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' });
    const to = last.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    return `${from} – ${to}`;
  });

  /** Short column heading: "Sat 12". */
  columnLabel(d: Date): string {
    return d.toLocaleDateString(this.localeTag(), { weekday: 'short', day: 'numeric' });
  }

  /** Stacked-list heading: "Saturday, 18 July". */
  longDayLabel(d: Date): string {
    return d.toLocaleDateString(this.localeTag(), { weekday: 'long', day: 'numeric', month: 'long' });
  }

  private localeTag(): string {
    return this.languageService.currentLang() === 'ar' ? 'ar-EG' : 'en-US';
  }

  showNowLine = computed(() => isSameDay(new Date(this.nowTick()), this.selectedDate()));

  nowLineTop = computed(() => {
    this.nowTick(); // re-trigger when nowTick changes
    const now = new Date();
    const minutes = (now.getHours() - DAY_START_HOUR) * 60 + now.getMinutes();
    if (minutes < 0) return 0;
    if (minutes > (DAY_END_HOUR - DAY_START_HOUR + 1) * 60) return this.totalGridHeight;
    return (minutes / 60) * HOUR_HEIGHT_PX;
  });

  nowLabel = computed(() => {
    this.nowTick();
    const now = new Date();
    return now.toLocaleTimeString(this.localeTag(), { hour: '2-digit', minute: '2-digit' });
  });

  ngOnInit() {
    this.loadFilters();
    this.load();
    setInterval(() => this.nowTick.set(Date.now()), 60000);
  }

  loadFilters() {
    this.lookupService.branches().subscribe({
      next: (b) => this.branches.set(b),
    });
    this.lookupService.rooms().subscribe({
      next: (r) => this.rooms.set(r),
    });
    this.courseService.getActiveCourses().subscribe({
      next: (c) => this.courses.set(c),
    });
    this.employeeService.getAllEmployees().subscribe({
      next: (employees) => {
        const teachers = employees
          .filter((e: any) => {
            const role = (e.role || e.position || '').toString().toUpperCase();
            return role.includes('TEACH') || role.includes('INSTRUCT') || role.includes('TRAIN');
          })
          .map((e: any) => ({
            id: e.id,
            displayName: `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email || 'Unnamed',
          }));
        // If filter produced nothing, fall back to all employees so the user still has options
        const result = teachers.length > 0
          ? teachers
          : employees.map((e: any) => ({
              id: e.id,
              displayName: `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email || 'Unnamed',
            }));
        this.teachers.set(result);
      },
    });
  }

  load() {
    if (this.isWeek()) {
      this.loadWeek();
      return;
    }
    this.loading.set(true);
    const dateStr = toLocalISODate(this.selectedDate());
    this.timetableService
      .getDay({ date: dateStr, ...this.activeFilters() })
      .subscribe({
        next: (res) => {
          this.entries.set(res.entries || []);
          this.dayOfWeek.set(res.dayOfWeek);
          this.loading.set(false);
        },
        error: () => {
          this.entries.set([]);
          this.loading.set(false);
        },
      });
  }

  /**
   * The week is seven day-loads fired together — the API answers one date at a
   * time, and seven small queries beat teaching it a second shape. A day that
   * fails comes back empty instead of blanking the whole week.
   */
  private loadWeek() {
    this.loading.set(true);
    const dates = this.weekDates();
    const filters = this.activeFilters();
    forkJoin(
      dates.map((d) =>
        this.timetableService
          .getDay({ date: toLocalISODate(d), ...filters })
          .pipe(catchError(() => of({ date: toLocalISODate(d), dayOfWeek: '', entries: [] })))
      )
    ).subscribe({
      next: (days) => {
        this.weekColumns.set(
          days.map((res, i) => ({ date: dates[i], iso: toLocalISODate(dates[i]), entries: res.entries || [] }))
        );
        this.loading.set(false);
      },
      error: () => {
        this.weekColumns.set([]);
        this.loading.set(false);
      },
    });
  }

  private activeFilters() {
    return {
      branchId: this.selectedBranchId || undefined,
      teacherId: this.selectedTeacherId || undefined,
      courseId: this.selectedCourseId || undefined,
      roomId: this.selectedRoomId || undefined,
    };
  }

  setViewMode(mode: ViewMode) {
    if (!mode || mode === this.viewMode()) return;
    this.viewMode.set(mode);
    this.load();
  }

  /** Layout only — both shapes read what's already loaded, so no reload. */
  setLayout(layout: Layout) {
    this.layout.set(layout);
  }

  /**
   * Open the list behind a count. `hour` is set when the click came from a grid
   * cell, so the title says which hour; a day-header click passes none and lists
   * the whole day.
   */
  openSessions(date: Date, entries: TimetableEntry[], hour?: number) {
    if (!entries.length) return;
    const day = this.longDayLabel(date);
    this.dialogTitle.set(hour === undefined ? day : `${day} · ${this.formatHour(hour)}`);
    this.dialogEntries.set([...entries].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')));
    this.dialogVisible.set(true);
  }

  /** From the list into the class itself. */
  openClass(classId: string) {
    this.dialogVisible.set(false);
    this.router.navigate(['/classes', classId]);
  }

  /** Jump to a single day's detailed grid — the "see these sessions" route out. */
  openDay(date: Date) {
    this.dialogVisible.set(false);
    this.selectedDate.set(date);
    this.setViewMode('DAY');
  }

  /** Steps a day at a time in day view, a week at a time in week view. */
  shiftDay(delta: number) {
    this.selectedDate.set(addDays(this.selectedDate(), this.isWeek() ? delta * 7 : delta));
    this.load();
  }

  goToToday() {
    this.selectedDate.set(new Date());
    this.load();
  }

  onDateChange(d: Date) {
    this.selectedDate.set(d);
    this.load();
  }

  isToday(d: Date): boolean {
    return isSameDay(d, new Date(this.nowTick()));
  }

  onFilterChange() {
    this.load();
  }

  clearFilters() {
    this.selectedBranchId = null;
    this.selectedTeacherId = null;
    this.selectedCourseId = null;
    this.selectedRoomId = null;
    this.load();
  }

  formatHour(hour: number): string {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return d.toLocaleTimeString(this.localeTag(), { hour: 'numeric' });
  }

  formatTimeShort(time: string | null): string {
    if (!time) return '';
    const parsed = parseHHMM(time);
    if (!parsed) return time;
    const d = new Date();
    d.setHours(parsed.h, parsed.m, 0, 0);
    return d.toLocaleTimeString(this.localeTag(), { hour: 'numeric', minute: '2-digit' });
  }

  entryClasses(entry: TimetableEntry): string {
    const c = colorForCourse(entry.courseId);
    return `${c.bg} ${c.border}`;
  }

  textColor(entry: TimetableEntry): string {
    return colorForCourse(entry.courseId).text;
  }
}
