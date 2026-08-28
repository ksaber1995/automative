import * as XLSX from 'xlsx';
import { Class, ClassDayTime } from '@shared/interfaces/class.interface';
import { to12h } from '../../core/utils/time-format.util';
import { downloadTablePdf } from '../../core/utils/pdf-table.util';

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
  school: string;
  branch: string;
  course: string;
  class: string;
  schedule: string;
  status: string;
}

export type StudentExportColumn = { key: keyof StudentExportRow; labelKey: string };

const ALL_COLUMNS: StudentExportColumn[] = [
  { key: 'code', labelKey: 'STUDENTS.EXPORT.COL_CODE' },
  { key: 'name', labelKey: 'STUDENTS.EXPORT.COL_NAME' },
  { key: 'phone', labelKey: 'STUDENTS.EXPORT.COL_PHONE' },
  { key: 'parentName', labelKey: 'STUDENTS.EXPORT.COL_PARENT' },
  { key: 'parentPhone', labelKey: 'STUDENTS.EXPORT.COL_PARENT_PHONE' },
  { key: 'school', labelKey: 'STUDENTS.EXPORT.COL_SCHOOL' },
  { key: 'branch', labelKey: 'STUDENTS.EXPORT.COL_BRANCH' },
  { key: 'course', labelKey: 'STUDENTS.EXPORT.COL_COURSE' },
  { key: 'class', labelKey: 'STUDENTS.EXPORT.COL_CLASS' },
  { key: 'schedule', labelKey: 'STUDENTS.EXPORT.COL_SCHEDULE' },
  { key: 'status', labelKey: 'STUDENTS.EXPORT.COL_STATUS' },
];

/**
 * Column order, shared by both outputs so they can't drift apart.
 *
 * Branch is dropped for a solo teacher and for any academy with a single branch:
 * a column repeating the same value on every row is noise, and on the PDF it
 * costs width the class time actually needs.
 */
export function studentExportColumns(opts: { includeBranch: boolean }): StudentExportColumn[] {
  return ALL_COLUMNS.filter((c) => c.key !== 'branch' || opts.includeBranch);
}

/** Localisation the schedule text needs — day names and the meridiem markers. */
export interface ScheduleLabels {
  /** Short localised day name for an UPPER weekday, e.g. MONDAY → Mon / إثنين. */
  dayLabel: (day: string) => string;
  am: string;
  pm: string;
}

/**
 * "Sat, Mon 10:00 AM - 11:00 AM", or a per-day list when the days don't share a
 * time. Prefers the per-day rows and falls back to the class-level start/end,
 * which is all an older class carries.
 */
export function formatClassSchedule(
  cls: Partial<Class> | undefined | null,
  labels: ScheduleLabels,
  fallback = '',
): string {
  if (!cls) return fallback;
  const day = (d: string) => labels.dayLabel((d || '').trim());
  const t = (x: string) => to12h(x, labels.am, labels.pm);
  const dayTimes = cls.dayTimes as ClassDayTime[] | undefined;

  if (dayTimes && dayTimes.length) {
    const distinct = new Set(dayTimes.map((d) => `${d.startTime}-${d.endTime}`));
    if (distinct.size === 1) {
      return `${dayTimes.map((d) => day(d.day)).join(', ')} ${t(dayTimes[0].startTime)} - ${t(dayTimes[0].endTime)}`;
    }
    return dayTimes.map((d) => `${day(d.day)} ${t(d.startTime)}-${t(d.endTime)}`).join(', ');
  }

  if (cls.daysOfWeek || cls.startTime) {
    const days = String(cls.daysOfWeek || '').split(',').filter(Boolean).map(day).join(', ');
    const time = cls.startTime ? `${t(cls.startTime)} - ${t(cls.endTime || '')}` : '';
    return [days, time].filter(Boolean).join(' ') || fallback;
  }
  return fallback;
}

/** A .xlsx of the rows, column widths sized to the content. */
export function exportStudentsToExcel(
  rows: StudentExportRow[],
  columns: StudentExportColumn[],
  headers: string[],
  filename: string,
  sheetName: string,
  rtl = false,
): void {
  const body = rows.map((r) => columns.map((c) => r[c.key]));
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...body]);

  // Without this every column is the same default width and the schedule — the
  // reason for the export — is the one that gets cut off.
  sheet['!cols'] = columns.map((c, i) => {
    const longest = Math.max(headers[i]?.length ?? 0, ...body.map((r) => String(r[i] ?? '').length));
    return { wch: Math.min(Math.max(longest + 2, 10), 40) };
  });
  // Dropdowns on the header row: sorting or filtering by class or class time is
  // the reason to open this in Excel at all, so it shouldn't need setting up.
  if (rows.length) {
    sheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rows.length, c: columns.length - 1 },
      }),
    };
  }

  const book = XLSX.utils.book_new();
  // Arabic: open the sheet right-to-left, so column A sits on the right and the
  // reading order matches the app. This is Excel's own sheet view flag, so the
  // column ORDER stays as built — reversing the array here would double-flip it.
  if (rtl) book.Workbook = { Views: [{ RTL: true }] };
  // Excel rejects sheet names over 31 chars or containing []:*?/\
  XLSX.utils.book_append_sheet(book, sheet, sheetName.replace(/[[\]:*?/\\]/g, '').slice(0, 31) || 'Students');
  XLSX.writeFile(book, filename);
}

/**
 * Download the list as a real .pdf file — the shared table-PDF renderer does
 * the HTML-capture work (see core/utils/pdf-table.util.ts for why the pages
 * are rendered by the browser rather than drawn by the PDF library).
 */
export async function downloadStudentsPdf(opts: {
  rows: StudentExportRow[];
  columns: StudentExportColumn[];
  headers: string[];
  title: string;
  subtitle: string;
  filename: string;
  rtl: boolean;
}): Promise<void> {
  const { rows, columns, headers, title, subtitle, filename, rtl } = opts;
  // Codes, phone numbers and schedule times are Latin digits; in an RTL page
  // they belong LTR or the bidi algorithm reorders them next to Arabic.
  const LTR_KEYS: StudentExportColumn['key'][] = ['code', 'phone', 'parentPhone', 'schedule'];
  await downloadTablePdf({
    headers,
    body: rows.map((r) => columns.map((c) => String(r[c.key] ?? ''))),
    ltrColumns: columns.map((c, i) => (LTR_KEYS.includes(c.key) ? i : -1)).filter((i) => i >= 0),
    title, subtitle, filename, rtl,
  });
}
