import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { TimetableService, TimetableEntry } from './timetable.service';
import { BranchService } from '../branches/services/branch.service';
import { CourseService } from '../courses/services/course.service';
import { EmployeeService } from '../employees/services/employee.service';
import { LanguageService } from '../../core/services/language.service';
import { Branch } from '@shared/interfaces/branch.interface';

interface PositionedEntry extends TimetableEntry {
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
}

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

@Component({
  selector: 'app-timetable',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    TagModule,
    TooltipModule,
    TranslateModule,
  ],
  template: `
    <div class="container-custom py-6 px-2 md:px-4">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">{{ 'TIMETABLE.TITLE' | translate }}</h1>
          <p class="text-gray-600 mt-1">{{ 'TIMETABLE.SUBTITLE' | translate }}</p>
        </div>

        <!-- Date navigation -->
        <div class="flex items-center gap-2">
          <p-button icon="pi pi-chevron-left" [outlined]="true" severity="secondary"
            (onClick)="shiftDay(-1)" [pTooltip]="'TIMETABLE.PREV_DAY' | translate"></p-button>

          <p-datepicker
            [(ngModel)]="selectedDate"
            (ngModelChange)="onDateChange($event)"
            [showIcon]="true"
            dateFormat="yy-mm-dd"
            [style]="{ width: '170px' }"
          ></p-datepicker>

          <p-button icon="pi pi-chevron-right" [outlined]="true" severity="secondary"
            (onClick)="shiftDay(1)" [pTooltip]="'TIMETABLE.NEXT_DAY' | translate"></p-button>

          <p-button [label]="'TIMETABLE.TODAY' | translate" icon="pi pi-calendar" [outlined]="true"
            severity="secondary" (onClick)="goToToday()"></p-button>
        </div>
      </div>

      <!-- Day banner -->
      <div class="bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-xl p-5 mb-5 shadow-md">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div>
            <p class="text-sm uppercase tracking-wider text-indigo-100">{{ dayOfWeekLabel() }}</p>
            <p class="text-2xl font-bold">{{ formattedDateLabel() }}</p>
          </div>
          <div class="flex items-center gap-6">
            <div>
              <p class="text-xs text-indigo-100">{{ 'TIMETABLE.STAT_SCHEDULED' | translate }}</p>
              <p class="text-2xl font-bold">{{ filteredEntries().length }}</p>
            </div>
            <div>
              <p class="text-xs text-indigo-100">{{ 'TIMETABLE.STAT_IN_PROGRESS' | translate }}</p>
              <p class="text-2xl font-bold">{{ inProgressCount() }}</p>
            </div>
            <div>
              <p class="text-xs text-indigo-100">{{ 'TIMETABLE.STAT_STUDENTS' | translate }}</p>
              <p class="text-2xl font-bold">{{ totalStudents() }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="bg-white rounded-xl border border-gray-200 p-4 mb-5">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">{{ 'TIMETABLE.FILTER_BRANCH' | translate }}</label>
            <p-select
              [options]="branches()"
              [(ngModel)]="selectedBranchId"
              (ngModelChange)="onFilterChange()"
              optionLabel="name"
              optionValue="id"
              appendTo="body"
              [placeholder]="'TIMETABLE.ALL_BRANCHES' | translate"
              [showClear]="true"
              [style]="{ width: '100%' }"
            ></p-select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">{{ 'TIMETABLE.FILTER_TEACHER' | translate }}</label>
            <p-select
              [options]="teachers()"
              [(ngModel)]="selectedTeacherId"
              (ngModelChange)="onFilterChange()"
              optionLabel="displayName"
              optionValue="id"
              appendTo="body"
              [placeholder]="'TIMETABLE.ALL_TEACHERS' | translate"
              [showClear]="true"
              [filter]="true"
              filterBy="displayName"
              [style]="{ width: '100%' }"
            ></p-select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">{{ 'TIMETABLE.FILTER_COURSE' | translate }}</label>
            <p-select
              [options]="courses()"
              [(ngModel)]="selectedCourseId"
              (ngModelChange)="onFilterChange()"
              optionLabel="name"
              optionValue="id"
              appendTo="body"
              [placeholder]="'TIMETABLE.ALL_COURSES' | translate"
              [showClear]="true"
              [filter]="true"
              filterBy="name"
              [style]="{ width: '100%' }"
            ></p-select>
          </div>
          <div class="flex items-end">
            @if (hasActiveFilters()) {
              <p-button [label]="'TIMETABLE.CLEAR_FILTERS' | translate" icon="pi pi-times" [outlined]="true"
                severity="secondary" (onClick)="clearFilters()"
                styleClass="w-full"></p-button>
            }
          </div>
        </div>
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-400">
          <i class="pi pi-spin pi-spinner text-3xl mb-2"></i>
          <p>{{ 'TIMETABLE.LOADING' | translate }}</p>
        </div>
      }

      @if (!loading() && filteredEntries().length === 0) {
        <div class="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-400">
          <i class="pi pi-calendar text-5xl text-gray-300 mb-3"></i>
          <p class="text-lg font-medium text-gray-600">{{ 'TIMETABLE.EMPTY_TITLE' | translate }}</p>
          <p class="text-sm">{{ 'TIMETABLE.EMPTY_HINT' | translate }}</p>
        </div>
      }

      <!-- Calendar -->
      @if (!loading() && filteredEntries().length > 0) {
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div class="flex">
            <!-- Hour rail -->
            <div class="w-20 shrink-0 border-r border-gray-200 bg-gray-50">
              <div class="h-10 border-b border-gray-200"></div>
              @for (hour of hours; track hour) {
                <div class="border-b border-gray-100 flex items-start justify-end pr-3 pt-1"
                  [style.height.px]="hourHeight">
                  <span class="text-xs font-medium text-gray-500">{{ formatHour(hour) }}</span>
                </div>
              }
            </div>

            <!-- Day grid -->
            <div class="flex-1 relative">
              <div class="h-10 border-b border-gray-200 bg-gray-50 px-4 flex items-center">
                <span class="text-sm font-semibold text-gray-700">{{ dayOfWeekLabel() }}</span>
                <span class="text-xs text-gray-400 ml-2">{{ 'TIMETABLE.CLASS_COUNT' | translate: { count: filteredEntries().length } }}</span>
              </div>

              <!-- Background grid lines -->
              <div class="relative" [style.height.px]="totalGridHeight">
                @for (hour of hours; track hour) {
                  <div class="absolute left-0 right-0 border-b border-gray-100"
                    [style.top.px]="(hour - dayStartHour) * hourHeight + hourHeight"></div>
                }

                <!-- Half-hour ghost lines -->
                @for (hour of hours; track hour) {
                  <div class="absolute left-0 right-0 border-b border-dashed border-gray-50"
                    [style.top.px]="(hour - dayStartHour) * hourHeight + hourHeight / 2"></div>
                }

                <!-- "Now" indicator if today -->
                @if (showNowLine()) {
                  <div class="absolute left-0 right-0 z-10 pointer-events-none"
                    [style.top.px]="nowLineTop()">
                    <div class="flex items-center">
                      <span class="w-2 h-2 rounded-full bg-red-500 -ml-1"></span>
                      <div class="flex-1 h-px bg-red-500"></div>
                      <span class="text-[10px] text-red-600 font-bold pr-2 bg-white">{{ nowLabel() }}</span>
                    </div>
                  </div>
                }

                <!-- Entries -->
                @for (entry of positionedEntries(); track entry.classId) {
                  <div
                    class="absolute rounded-lg border-l-4 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                    [class]="entryClasses(entry)"
                    [style.top.px]="entry.topPx"
                    [style.height.px]="entry.heightPx"
                    [style.left]="'calc(' + entry.leftPct + '% + 8px)'"
                    [style.width]="'calc(' + entry.widthPct + '% - 16px)'"
                  >
                    <div class="p-2 h-full flex flex-col">
                      <div class="flex items-start justify-between gap-1 mb-1">
                        <span class="font-bold text-sm leading-tight" [class]="textColor(entry)">
                          {{ entry.className }}
                        </span>
                        @if (entry.isInProgress) {
                          <span class="shrink-0 inline-flex items-center gap-1 bg-green-100 text-green-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                            {{ 'TIMETABLE.LIVE' | translate }}
                          </span>
                        }
                      </div>

                      <div class="text-[11px] space-y-0.5" [class]="textColor(entry)">
                        @if (entry.courseName) {
                          <div class="flex items-center gap-1 opacity-80">
                            <i class="pi pi-book text-[10px]"></i>
                            <span class="truncate">{{ entry.courseName }}</span>
                          </div>
                        }
                        @if (entry.instructorName) {
                          <div class="flex items-center gap-1 opacity-80">
                            <i class="pi pi-user text-[10px]"></i>
                            <span class="truncate">{{ entry.instructorName }}</span>
                          </div>
                        }
                        @if (entry.branchName) {
                          <div class="flex items-center gap-1 opacity-80">
                            <i class="pi pi-building text-[10px]"></i>
                            <span class="truncate">{{ entry.branchName }}</span>
                          </div>
                        }
                        @if (entry.roomCode) {
                          <div class="flex items-center gap-1 opacity-80">
                            <i class="pi pi-map-marker text-[10px]"></i>
                            <span class="truncate">{{ 'TIMETABLE.ROOM_PREFIX' | translate: { code: entry.roomCode } }}</span>
                          </div>
                        }
                      </div>

                      <div class="mt-auto pt-1 flex items-center justify-between text-[10px] font-medium" [class]="textColor(entry)">
                        <span class="opacity-90">
                          <i class="pi pi-clock text-[9px] mr-0.5"></i>
                          {{ formatTimeShort(entry.startTime) }} – {{ formatTimeShort(entry.endTime) }}
                        </span>
                        <span class="opacity-80">
                          <i class="pi pi-users text-[9px] mr-0.5"></i>
                          {{ entry.studentCount }}{{ entry.maxStudents ? '/' + entry.maxStudents : '' }}
                        </span>
                      </div>
                    </div>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
  `],
})
export class TimetableComponent implements OnInit {
  private timetableService = inject(TimetableService);
  private branchService = inject(BranchService);
  private courseService = inject(CourseService);
  private employeeService = inject(EmployeeService);
  private languageService = inject(LanguageService);

  hours = HOURS;
  hourHeight = HOUR_HEIGHT_PX;
  dayStartHour = DAY_START_HOUR;
  totalGridHeight = (DAY_END_HOUR - DAY_START_HOUR + 1) * HOUR_HEIGHT_PX;

  selectedDate: Date = new Date();
  selectedBranchId: string | null = null;
  selectedTeacherId: string | null = null;
  selectedCourseId: string | null = null;

  loading = signal(false);
  entries = signal<TimetableEntry[]>([]);
  branches = signal<Branch[]>([]);
  teachers = signal<any[]>([]);
  courses = signal<any[]>([]);

  dayOfWeek = signal<string>('');

  /** ticking signal for the now-line, refreshed every minute */
  nowTick = signal<number>(Date.now());

  filteredEntries = computed(() => this.entries());

  inProgressCount = computed(() =>
    this.filteredEntries().filter((e) => e.isInProgress).length
  );

  totalStudents = computed(() =>
    this.filteredEntries().reduce((sum, e) => sum + (e.studentCount || 0), 0)
  );

  positionedEntries = computed<PositionedEntry[]>(() => {
    const entries = this.filteredEntries();
    if (entries.length === 0) return [];

    // Compute top/height for each entry from start_time / end_time.
    const sized = entries
      .map((e) => {
        const start = parseHHMM(e.startTime);
        const end = parseHHMM(e.endTime);
        if (!start || !end) return null;

        const startMinutes = (start.h - DAY_START_HOUR) * 60 + start.m;
        const endMinutes = (end.h - DAY_START_HOUR) * 60 + end.m;

        const clampedStart = Math.max(0, startMinutes);
        const clampedEnd = Math.min(this.totalGridHeight / (HOUR_HEIGHT_PX / 60), endMinutes);

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
  });

  hasActiveFilters = computed(() =>
    !!this.selectedBranchId || !!this.selectedTeacherId || !!this.selectedCourseId
  );

  formattedDateLabel = computed(() => {
    const d = this.selectedDate;
    return d.toLocaleDateString(this.localeTag(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  });

  dayOfWeekLabel = computed(() => {
    const d = this.selectedDate;
    return d.toLocaleDateString(this.localeTag(), { weekday: 'long' });
  });

  private localeTag(): string {
    return this.languageService.currentLang() === 'ar' ? 'ar-EG' : 'en-US';
  }

  showNowLine = computed(() => {
    const today = new Date();
    return (
      today.getFullYear() === this.selectedDate.getFullYear() &&
      today.getMonth() === this.selectedDate.getMonth() &&
      today.getDate() === this.selectedDate.getDate()
    );
  });

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
    this.branchService.getActiveBranches().subscribe({
      next: (b) => this.branches.set(b),
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
    this.loading.set(true);
    const dateStr = toLocalISODate(this.selectedDate);
    this.timetableService
      .getDay({
        date: dateStr,
        branchId: this.selectedBranchId || undefined,
        teacherId: this.selectedTeacherId || undefined,
        courseId: this.selectedCourseId || undefined,
      })
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

  shiftDay(delta: number) {
    const d = new Date(this.selectedDate);
    d.setDate(d.getDate() + delta);
    this.selectedDate = d;
    this.load();
  }

  goToToday() {
    this.selectedDate = new Date();
    this.load();
  }

  onDateChange(_d: Date) {
    this.load();
  }

  onFilterChange() {
    this.load();
  }

  clearFilters() {
    this.selectedBranchId = null;
    this.selectedTeacherId = null;
    this.selectedCourseId = null;
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
