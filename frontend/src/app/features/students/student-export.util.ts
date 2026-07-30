import * as XLSX from 'xlsx';
import { Class, ClassDayTime } from '@shared/interfaces/class.interface';
import { esc } from '../../core/utils/print-report.util';

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

// A4 landscape — ten columns do not fit across a portrait page.
const PAGE_W_MM = 297;
const PAGE_H_MM = 210;
const MARGIN_MM = 10;
/** Render width in CSS px for A4 landscape at 96dpi; the canvas is scaled up from here. */
const PAGE_W_PX = 1123;
const CONTENT_W_MM = PAGE_W_MM - MARGIN_MM * 2;
const CONTENT_H_MM = PAGE_H_MM - MARGIN_MM * 2;
const CONTENT_H_PX = Math.floor((PAGE_W_PX - 2) * (CONTENT_H_MM / CONTENT_W_MM));

// Tight on purpose. Loose padding put only ~14 rows on a page, which turns a
// normal roster into a 35-page file; this fits ~26 without becoming unreadable.
const PDF_CSS = `
  * { box-sizing: border-box; }
  .pg { width: ${PAGE_W_PX}px; background: #fff; color: #111827; padding: 0;
        font-family: system-ui, "Segoe UI", Tahoma, "Noto Naskh Arabic", sans-serif;
        font-size: 11px; line-height: 1.25; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .meta { color: #6b7280; font-size: 11px; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 3px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  th { background: #f3f4f6; font-size: 10px; color: #374151; font-weight: 700; }
`;

/** Offscreen, but really laid out — a display:none subtree has no measurable height. */
function makeStage(rtl: boolean): HTMLDivElement {
  const stage = document.createElement('div');
  stage.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  stage.style.cssText = `position:fixed; top:0; left:-20000px; width:${PAGE_W_PX}px; background:#fff; z-index:-1;`;
  const style = document.createElement('style');
  style.textContent = PDF_CSS;
  stage.appendChild(style);
  document.body.appendChild(stage);
  return stage;
}

function rowHtml(r: StudentExportRow, rtl: boolean): string {
  return `<tr>${STUDENT_EXPORT_COLUMNS.map((c) => {
    // Codes and phone numbers are Latin digits; in an RTL page they belong on
    // the left, and without an explicit dir they get reordered by the bidi
    // algorithm when they sit next to Arabic.
    const ltrCell = c.key === 'code' || c.key === 'phone' || c.key === 'parentPhone' || c.key === 'schedule';
    return `<td${ltrCell && rtl ? ' dir="ltr" style="text-align:right"' : ''}>${esc(r[c.key])}</td>`;
  }).join('')}</tr>`;
}

/**
 * Download the list as a real .pdf file.
 *
 * The pages are rendered as HTML and captured with html2canvas rather than drawn
 * with the PDF library's own text calls. That is deliberate: this app is
 * Arabic-first, and the JS PDF text APIs do not shape or reorder Arabic — names
 * come out as disconnected, backwards glyphs unless a full Arabic font is
 * embedded, and even then the joining is wrong. The browser already shapes the
 * exact same markup correctly on screen, so we let it do the typesetting and put
 * the result in the PDF. The trade-off is that the text is an image, not
 * selectable; correct names matter more than selectable ones here.
 *
 * Rows are measured first and grouped into pages so nothing is sliced through
 * the middle, and every page repeats the table header.
 */
export async function downloadStudentsPdf(opts: {
  rows: StudentExportRow[];
  headers: string[];
  title: string;
  subtitle: string;
  filename: string;
  rtl: boolean;
}): Promise<void> {
  const { rows, headers, title, subtitle, filename, rtl } = opts;

  // Loaded on demand: together these are ~600 KB, and most sessions never export.
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const headHtml = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const titleHtml = `<h1>${esc(title)}</h1><div class="meta">${esc(subtitle)}</div>`;

  const stage = makeStage(rtl);
  try {
    // Pass 1 — measure. One table with every row, to learn each row's real
    // height (a long class name wraps, so they are not uniform).
    const probe = document.createElement('div');
    probe.className = 'pg';
    probe.innerHTML = `${titleHtml}<table><thead>${headHtml}</thead><tbody>${rows.map((r) => rowHtml(r, rtl)).join('')}</tbody></table>`;
    stage.appendChild(probe);

    const titleH = (probe.querySelector('table') as HTMLElement).offsetTop;
    const theadH = (probe.querySelector('thead') as HTMLElement).offsetHeight;
    const rowHeights = Array.from(probe.querySelectorAll('tbody tr')).map((tr) => (tr as HTMLElement).offsetHeight);
    stage.removeChild(probe);

    // Group rows into pages. Page 1 also carries the title block.
    const pages: StudentExportRow[][] = [];
    let current: StudentExportRow[] = [];
    let used = titleH + theadH;
    for (let i = 0; i < rows.length; i++) {
      const h = rowHeights[i] || 24;
      if (current.length && used + h > CONTENT_H_PX) {
        pages.push(current);
        current = [];
        used = theadH; // later pages repeat the header but not the title
      }
      current.push(rows[i]);
      used += h;
    }
    if (current.length) pages.push(current);

    // Pass 2 — render each page on its own, so the header repeats and no row is
    // cut in half by a page break.
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    for (let p = 0; p < pages.length; p++) {
      const page = document.createElement('div');
      page.className = 'pg';
      page.innerHTML = (p === 0 ? titleHtml : '')
        + `<table><thead>${headHtml}</thead><tbody>${pages[p].map((r) => rowHtml(r, rtl)).join('')}</tbody></table>`;
      stage.appendChild(page);

      // scale 1.5 puts ~1684px across 277mm (~154 dpi) — crisp enough to print.
      const canvas = await html2canvas(page, { scale: 1.5, backgroundColor: '#ffffff', logging: false });
      stage.removeChild(page);

      if (p > 0) doc.addPage();
      // Height follows the captured aspect ratio, so nothing is stretched.
      const hMm = Math.min((canvas.height / canvas.width) * CONTENT_W_MM, CONTENT_H_MM);
      // JPEG, not PNG: a full-colour PNG of a text page ran ~375 KB and a
      // 30-row export came to 21 MB. At q0.8 a page is ~200 KB and reads the same.
      doc.addImage(canvas.toDataURL('image/jpeg', 0.8), 'JPEG', MARGIN_MM, MARGIN_MM, CONTENT_W_MM, hMm);

      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`${p + 1} / ${pages.length}`, PAGE_W_MM - MARGIN_MM, PAGE_H_MM - 4, { align: 'right' });
    }

    doc.save(filename);
  } finally {
    stage.remove();
  }
}
