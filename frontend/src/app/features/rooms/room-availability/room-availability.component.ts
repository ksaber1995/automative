import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RoomService } from '../services/room.service';
import { ClassService } from '../../courses/services/class.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { Class } from '@shared/interfaces/class.interface';
import { esc, openPrintWindow, section, th } from '../../../core/utils/print-report.util';
import { formatDuration, minutesToTime, timeToMinutes, to12h } from '../../../core/utils/time-format.util';
import { RoomWeek, WEEK_DAYS, buildRoomWeeks, deriveWindow } from '../room-availability.util';

/**
 * When is each room free — the inverse of the timetable, which answers "what is
 * on now". This answers "where could a new class go", so it leads with the gaps
 * and is built to be printed and marked up on paper.
 *
 * The week comes from the CLASSES booked into each room, not from sessions: a
 * session is a single occurrence that only exists once the day arrives, whereas
 * this is a question about the room's ongoing week.
 */
@Component({
  selector: 'app-room-availability',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, SelectModule, MultiSelectModule, TranslateModule],
  templateUrl: './room-availability.component.html',
})
export class RoomAvailabilityComponent implements OnInit {
  private roomService = inject(RoomService);
  private classService = inject(ClassService);
  private lookupService = inject(LookupService);
  private translate = inject(TranslateService);

  loading = signal(true);
  rooms = signal<{ id: string; code: string; branchName?: string; branchId: string }[]>([]);
  classes = signal<Class[]>([]);
  branches = signal<LookupOption[]>([]);

  branchId = signal<string>('');
  /**
   * Which rooms to show. Empty means all — the common case, and it keeps "show
   * me everything" from needing every room ticked. Narrowing to one or a few is
   * what you do once you know which rooms you would actually put a class in.
   */
  roomIds = signal<string[]>([]);
  /**
   * The hours the academy actually runs; gaps outside these are not offerable.
   * Seeded from the real class times once they load — see deriveWindow — because
   * a fixed guess can miss a tenant's whole day and then report every room free.
   */
  windowStart = signal('08:00');
  windowEnd = signal('22:00');
  /** A gap shorter than this is not a slot anyone can teach in. */
  minMinutes = signal(60);

  minOptions = computed(() => [30, 45, 60, 90, 120].map((m) => ({
    label: formatDuration(m, this.translate.instant('ROOM_FREE.H'), this.translate.instant('ROOM_FREE.M')),
    value: m,
  })));

  weekDays = WEEK_DAYS;

  /** Localised short day name, reusing the class list's existing keys. */
  dayLabel(day: string): string {
    const key = `CLASSES.LIST.DAY_${day.toUpperCase()}`;
    const label = this.translate.instant(key);
    return label && label !== key ? label : day.slice(0, 3);
  }

  time(t: string): string {
    return to12h(t, this.translate.instant('STUDENTS.EXPORT.AM'), this.translate.instant('STUDENTS.EXPORT.PM'));
  }

  duration(mins: number): string {
    return formatDuration(mins, this.translate.instant('ROOM_FREE.H'), this.translate.instant('ROOM_FREE.M'));
  }

  /**
   * Emptiest room first: the whole point is to find somewhere to put a new
   * class, so the rooms with most to offer should not be buried under the busy
   * ones. Ties fall back to the room code so the order is stable between loads.
   */
  roomWeeks = computed<RoomWeek[]>(() => {
    const start = timeToMinutes(this.windowStart()) ?? 8 * 60;
    const end = timeToMinutes(this.windowEnd()) ?? 22 * 60;
    if (end <= start) return [];

    const branch = this.branchId();
    const picked = new Set(this.roomIds());
    const rooms = this.rooms()
      .filter((r) => !branch || r.branchId === branch)
      .filter((r) => picked.size === 0 || picked.has(r.id));

    return buildRoomWeeks({
      rooms,
      classes: this.classes(),
      windowStart: start,
      windowEnd: end,
      minMinutes: this.minMinutes(),
    }).sort((a, b) => b.freeMinutes - a.freeMinutes || a.roomCode.localeCompare(b.roomCode));
  });

  /** True when the window is back-to-front, which would silently show nothing. */
  badWindow = computed(() => {
    const s = timeToMinutes(this.windowStart());
    const e = timeToMinutes(this.windowEnd());
    return s === null || e === null || e <= s;
  });

  totalFreeHours = computed(() =>
    Math.round(this.roomWeeks().reduce((sum, r) => sum + r.freeMinutes, 0) / 6) / 10);

  /** The rooms offered in the picker, narrowed by the chosen branch. */
  roomOptions = computed(() => {
    const branch = this.branchId();
    return this.rooms()
      .filter((r) => !branch || r.branchId === branch)
      .map((r) => ({ label: r.branchName ? `${r.code} — ${r.branchName}` : r.code, value: r.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  /**
   * Switching branch can leave rooms selected that the new branch does not have,
   * which would show an empty grid with no visible reason. Drop those.
   */
  onBranchChange(id: string | null): void {
    this.branchId.set(id ?? '');
    const allowed = new Set(this.roomOptions().map((o) => o.value));
    this.roomIds.set(this.roomIds().filter((r) => allowed.has(r)));
  }

  ngOnInit(): void {
    this.lookupService.branches().subscribe({ next: (b) => this.branches.set(b) });

    let pending = 2;
    const done = () => { if (--pending === 0) this.loading.set(false); };
    this.roomService.list().subscribe({
      next: (rows) => {
        this.rooms.set(rows
          .filter((r) => r.isActive !== false)
          .map((r) => ({ id: r.id, code: r.code, branchName: r.branchName, branchId: r.branchId })));
        done();
      },
      error: done,
    });
    this.classService.getAllClasses().subscribe({
      next: (rows) => {
        this.classes.set(rows);
        const w = deriveWindow(rows);
        this.windowStart.set(minutesToTime(w.start));
        this.windowEnd.set(minutesToTime(w.end));
        done();
      },
      error: done,
    });
  }

  /**
   * Print the sheet. This is the reason the page exists — the schedule gets
   * printed, read on paper, and a slot handed to a new teacher — so the printed
   * version leads with the free times and keeps what is booked as small grey
   * text underneath, rather than being a screenshot of the screen.
   */
  print(): void {
    const t = (k: string, p?: object) => this.translate.instant(k, p);
    const rtl = (this.translate.currentLang || 'en').startsWith('ar');
    const weeks = this.roomWeeks();

    const rows = weeks.map((rw) => `
      <tr>
        <td><strong>${esc(rw.roomCode)}</strong>
          ${rw.branchName ? `<div class="sub">${esc(rw.branchName)}</div>` : ''}
          <div class="sub">${esc(t('ROOM_FREE.FREE_TOTAL', { hours: Math.round(rw.freeMinutes / 6) / 10 }))}</div>
        </td>
        ${rw.days.map((d) => `
          <td>
            ${d.free.length
              ? d.free.map((f) => `<div>${esc(this.time(f.startLabel))} – ${esc(this.time(f.endLabel))}</div>`).join('')
              : `<div class="sub">${esc(t('ROOM_FREE.NONE'))}</div>`}
            ${d.busy.length
              ? `<div class="sub busy">${d.busy.map((b) => esc(`${b.className} ${minutesToTime(b.start)}-${minutesToTime(b.end)}`)).join('<br>')}</div>`
              : ''}
          </td>`).join('')}
      </tr>`).join('');

    const branchName = this.branches().find((b) => b.id === this.branchId())?.label;
    const subtitle = [
      branchName,
      `${this.time(this.windowStart())} – ${this.time(this.windowEnd())}`,
      t('ROOM_FREE.MIN_SLOT_SHORT', { len: this.duration(this.minMinutes()) }),
      new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    ].filter(Boolean).join(' · ');

    openPrintWindow({
      title: t('ROOM_FREE.TITLE'),
      rtl,
      landscape: true,
      body: `
        <h1>${esc(t('ROOM_FREE.TITLE'))}</h1>
        <div class="meta">${esc(subtitle)}</div>
        <style>
          /* Booked classes are context, not the answer — keep them out of the way. */
          .busy { color: #9ca3af; margin-top: 3px; border-top: 1px dotted #e5e7eb; padding-top: 3px; }
          td { font-size: 10px; }
        </style>
        ${section(
          '',
          th([[t('ROOM_FREE.COL_ROOM'), false], ...this.weekDays.map((d) => [this.dayLabel(d), false] as [string, boolean])]),
          rows,
          t('ROOM_FREE.EMPTY'),
        )}`,
    });
  }
}
