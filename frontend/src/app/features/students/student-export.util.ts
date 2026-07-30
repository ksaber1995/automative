import * as XLSX from 'xlsx';
import { Class, ClassDayTime } from '@shared/interfaces/class.interface';
import { esc, openPrintWindow, section, th } from '../../core/utils/print-report.util';

/**
 * Exporting the students list with the class times each student is booked into.
 *
 * One row per student-and-class, not per student: a student in two classes has
 * two class times, and folding them into one cell makes the whole point of the
 * export — filtering and sorting by class or time in Excel — impossible. A
 * student with no enrollment still gets their row, with the class columns blank.
 */

export interface StudentExportRow {
  code: string;
  name: string;
  phone: string;
  parentName: string;
  parentPhone: string;
  branch: string;
  course: string;
  class: string;
  schedule: string;
  status: string;
}

/** Column order, shared by both outputs so they can't drift apart. */
export const STUDENT_EXPORT_COLUMNS: { key: keyof StudentExportRow; labelKey: string }[] = [
  { key: 'code', labelKey: 'STUDENTS.EXPORT.COL_CODE' },
  { key: 'name', labelKey: 'STUDENTS.EXPORT.COL_NAME' },
  { key: 'phone', labelKey: 'STUDENTS.EXPORT.COL_PHONE' },
  { key: 'parentName', labelKey: 'STUDENTS.EXPORT.COL_PARENT' },
  { key: 'parentPhone', labelKey: 'STUDENTS.EXPORT.COL_PARENT_PHONE' },
  { key: 'branch', labelKey: 'STUDENTS.EXPORT.COL_BRANCH' },
  { key: 'course', labelKey: 'STUDENTS.EXPORT.COL_COURSE' },
  { key: 'class', labelKey: 'STUDENTS.EXPORT.COL_CLASS' },
  { key: 'schedule', labelKey: 'STUDENTS.EXPORT.COL_SCHEDULE' },
  { key: 'status', labelKey: 'STUDENTS.EXPORT.COL_STATUS' },
];

/**
 * "SAT, MON 10:00 - 11:00", or a per-day list when the days don't share a time.
 * Prefers the per-day rows and falls back to the class-level start/end, which is
 * all an older class carries.
 */
export function formatClassSchedule(cls: Partial<Class> | undefined | null, fallback = ''): string {
  if (!cls) return fallback;
  const short = (d: string) => (d || '').trim().slice(0, 3).toUpperCase();
  const hm = (t: string) => (t || '').slice(0, 5);
  const dayTimes = cls.dayTimes as ClassDayTime[] | undefined;

  if (dayTimes && dayTimes.length) {
    const distinct = new Set(dayTimes.map((d) => `${d.startTime}-${d.endTime}`));
    if (distinct.size === 1) {
      return `${dayTimes.map((d) => short(d.day)).join(', ')} ${hm(dayTimes[0].startTime)} - ${hm(dayTimes[0].endTime)}`;
    }
    return dayTimes.map((d) => `${short(d.day)} ${hm(d.startTime)}-${hm(d.endTime)}`).join(', ');
  }

  if (cls.daysOfWeek || cls.startTime) {
    const days = String(cls.daysOfWeek || '').split(',').filter(Boolean).map(short).join(', ');
    const time = cls.startTime ? `${hm(cls.startTime)} - ${hm(cls.endTime || '')}` : '';
    return [days, time].filter(Boolean).join(' ') || fallback;
  }
  return fallback;
}

/** A .xlsx of the rows, column widths sized to the content. */
export function exportStudentsToExcel(
  rows: StudentExportRow[],
  headers: string[],
  filename: string,
  sheetName: string,
): void {
  const body = rows.map((r) => STUDENT_EXPORT_COLUMNS.map((c) => r[c.key]));
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...body]);

  // Without this every column is the same default width and the schedule — the
  // reason for the export — is the one that gets cut off.
  sheet['!cols'] = STUDENT_EXPORT_COLUMNS.map((c, i) => {
    const longest = Math.max(headers[i]?.length ?? 0, ...body.map((r) => String(r[i] ?? '').length));
    return { wch: Math.min(Math.max(longest + 2, 10), 40) };
  });
  // Dropdowns on the header row: sorting or filtering by class or class time is
  // the reason to open this in Excel at all, so it shouldn't need setting up.
  if (rows.length) {
    sheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rows.length, c: STUDENT_EXPORT_COLUMNS.length - 1 },
      }),
    };
  }

  const book = XLSX.utils.book_new();
  // Excel rejects sheet names over 31 chars or containing []:*?/\
  XLSX.utils.book_append_sheet(book, sheet, sheetName.replace(/[[\]:*?/\\]/g, '').slice(0, 31) || 'Students');
  XLSX.writeFile(book, filename);
}

/**
 * The PDF, produced through the browser's print dialog ("Save as PDF") rather
 * than a PDF library. This app is Arabic-first, and the JS PDF generators render
 * Arabic as disconnected, backwards glyphs unless a full Arabic font is embedded
 * — a large binary for a worse result than the browser, which already shapes
 * and lays out the same text correctly on screen.
 */
export function printStudentsPdf(opts: {
  rows: StudentExportRow[];
  headers: string[];
  title: string;
  subtitle: string;
  emptyLabel: string;
  rtl: boolean;
}): void {
  const { rows, headers, title, subtitle, emptyLabel, rtl } = opts;

  const body = rows.map((r) => `
    <tr>${STUDENT_EXPORT_COLUMNS.map((c) => {
      const numeric = c.key === 'code';
      return `<td class="${numeric ? 'num' : ''}">${esc(r[c.key])}</td>`;
    }).join('')}</tr>`).join('');

  openPrintWindow({
    title,
    rtl,
    // Landscape: ten columns do not fit across a portrait page.
    landscape: true,
    body: `
      <h1>${esc(title)}</h1>
      <div class="meta">${esc(subtitle)}</div>
      ${section('', th(headers.map((h) => [h, false] as [string, boolean])), body, emptyLabel)}`,
  });
}
