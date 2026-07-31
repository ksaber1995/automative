import { Class, ClassDayTime } from '@shared/interfaces/class.interface';
import { minutesToTime, timeToMinutes } from '../../core/utils/time-format.util';

/**
 * When a room is free, worked out from the classes booked into it.
 *
 * A room's week comes from the CLASSES assigned to it, not from sessions: a
 * session is one occurrence and only exists once the day arrives, whereas the
 * question here is "what does this room's week look like from now on", which is
 * exactly what the class schedule says.
 */

/** The academy week, Saturday first — the working week where this is used. */
export const WEEK_DAYS = [
  'SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY',
] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export interface Interval {
  /** Minutes from midnight. */
  start: number;
  end: number;
}

export interface FreeSlot extends Interval {
  startLabel: string;   // "14:00"
  endLabel: string;
  minutes: number;
}

export interface BusyBlock extends Interval {
  className: string;
}

export interface RoomDay {
  day: WeekDay;
  busy: BusyBlock[];
  free: FreeSlot[];
  /** Nothing booked at all — the whole window is one free slot. */
  emptyAllDay: boolean;
}

export interface RoomWeek {
  roomId: string;
  roomCode: string;
  branchName: string;
  days: RoomDay[];
  /** Free minutes across the week, for sorting the emptiest rooms first. */
  freeMinutes: number;
}

/**
 * Is this class still going to occupy the room? Anything that no longer runs
 * holds nothing, and counting it as busy is what would hide a genuinely free
 * slot — the one mistake this page cannot afford to make.
 *
 * `endDate` matters as much as the finished flag: a term that ended in May and
 * was never marked finished is still IN_PROGRESS as far as the API is concerned
 * (status is derived from is_finished and start_date only), so without this the
 * room would look booked forever.
 *
 * A class starting later still holds the room — it is booked, just not yet.
 */
export function classHoldsRoom(c: Class, today = new Date()): boolean {
  if (!c.roomId) return false;
  if (c.isActive === false || c.status === 'DONE' || c.isFinished === true) return false;
  if (c.endDate) {
    const end = new Date(c.endDate);
    if (!Number.isNaN(end.getTime())) {
      // Compare by calendar day: a class ending today still runs today.
      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (endDay.getTime() < todayDay.getTime()) return false;
    }
  }
  return true;
}

/**
 * The day/time pairs a class occupies. Per-day rows are the source of truth;
 * the class-level daysOfWeek + start/end is the older envelope and only used
 * when a class has no per-day rows.
 */
export function classOccupancy(c: Class): { day: string; start: number; end: number }[] {
  const out: { day: string; start: number; end: number }[] = [];
  const dayTimes = c.dayTimes as ClassDayTime[] | undefined;

  if (dayTimes && dayTimes.length) {
    for (const dt of dayTimes) {
      const start = timeToMinutes(dt.startTime);
      const end = timeToMinutes(dt.endTime);
      if (start === null || end === null || end <= start) continue;
      out.push({ day: (dt.day || '').toUpperCase(), start, end });
    }
    return out;
  }

  const start = timeToMinutes(c.startTime);
  const end = timeToMinutes(c.endTime);
  if (start === null || end === null || end <= start) return out;
  for (const d of String(c.daysOfWeek || '').split(',')) {
    const day = d.trim().toUpperCase();
    if (day) out.push({ day, start, end });
  }
  return out;
}

/**
 * The day window to open with, taken from the classes themselves rather than a
 * fixed 08:00–22:00.
 *
 * Tenants do not agree on what a clock time means: one academy's classes are
 * stored at 14:00, another's at 02:00 for the same afternoon lesson. A hard-
 * coded window silently sat outside the second one's entire day and reported
 * every room free all week — the worst possible failure for this page, because
 * it looks like an answer. Bracketing the real times cannot miss them.
 *
 * Rounded out to whole hours so the sheet has tidy edges, and widened slightly
 * so the first and last class are not flush against the border.
 */
export function deriveWindow(
  classes: Class[],
  today?: Date,
): { start: number; end: number } {
  let min: number | null = null;
  let max: number | null = null;
  for (const c of classes) {
    if (!classHoldsRoom(c, today)) continue;
    for (const occ of classOccupancy(c)) {
      if (min === null || occ.start < min) min = occ.start;
      if (max === null || occ.end > max) max = occ.end;
    }
  }
  // Nothing booked anywhere — a plain working day is as good a guess as any.
  if (min === null || max === null) return { start: 8 * 60, end: 22 * 60 };
  const start = Math.max(0, Math.floor(min / 60) * 60 - 60);
  const end = Math.min(24 * 60, Math.ceil(max / 60) * 60 + 60);
  return { start, end };
}

/** Merge overlapping/touching intervals so gaps are computed against one run. */
export function mergeIntervals<T extends Interval>(items: T[]): Interval[] {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const it of sorted) {
    const last = merged[merged.length - 1];
    if (last && it.start <= last.end) {
      last.end = Math.max(last.end, it.end);
    } else {
      merged.push({ start: it.start, end: it.end });
    }
  }
  return merged;
}

/**
 * The gaps left in [windowStart, windowEnd] once the busy blocks are removed.
 * Anything shorter than minMinutes is dropped — a 10-minute gap is not a slot
 * you can offer a teacher, and listing it only makes the sheet harder to read.
 */
export function freeGaps(busy: Interval[], windowStart: number, windowEnd: number, minMinutes: number): FreeSlot[] {
  const slots: FreeSlot[] = [];
  let cursor = windowStart;
  for (const b of mergeIntervals(busy)) {
    if (b.end <= windowStart || b.start >= windowEnd) continue;   // outside the window
    const start = Math.max(b.start, windowStart);
    if (start - cursor >= minMinutes) slots.push(toSlot(cursor, start));
    cursor = Math.max(cursor, Math.min(b.end, windowEnd));
  }
  if (windowEnd - cursor >= minMinutes) slots.push(toSlot(cursor, windowEnd));
  return slots;
}

function toSlot(start: number, end: number): FreeSlot {
  return { start, end, startLabel: minutesToTime(start), endLabel: minutesToTime(end), minutes: end - start };
}

/**
 * The whole grid: one row per room, one cell per weekday.
 *
 * Rooms with nothing booked are the point of the exercise, so they are kept and
 * marked rather than filtered out for having no classes to report.
 */
export function buildRoomWeeks(opts: {
  rooms: { id: string; code: string; branchName?: string }[];
  classes: Class[];
  windowStart: number;
  windowEnd: number;
  minMinutes: number;
  /** Injectable so the "has it ended" cut can be tested without faking a clock. */
  today?: Date;
}): RoomWeek[] {
  const { rooms, classes, windowStart, windowEnd, minMinutes, today } = opts;

  // roomId → day → busy blocks
  const byRoom = new Map<string, Map<string, BusyBlock[]>>();
  for (const c of classes) {
    if (!classHoldsRoom(c, today)) continue;
    for (const occ of classOccupancy(c)) {
      if (!byRoom.has(c.roomId!)) byRoom.set(c.roomId!, new Map());
      const days = byRoom.get(c.roomId!)!;
      if (!days.has(occ.day)) days.set(occ.day, []);
      days.get(occ.day)!.push({ start: occ.start, end: occ.end, className: c.name });
    }
  }

  return rooms.map((room) => {
    const days = byRoom.get(room.id) ?? new Map<string, BusyBlock[]>();
    let freeMinutes = 0;
    const rows: RoomDay[] = WEEK_DAYS.map((day) => {
      const busy = (days.get(day) ?? []).sort((a, b) => a.start - b.start);
      const free = freeGaps(busy, windowStart, windowEnd, minMinutes);
      freeMinutes += free.reduce((s, f) => s + f.minutes, 0);
      return { day, busy, free, emptyAllDay: busy.length === 0 };
    });
    return {
      roomId: room.id,
      roomCode: room.code,
      branchName: room.branchName ?? '',
      days: rows,
      freeMinutes,
    };
  });
}
