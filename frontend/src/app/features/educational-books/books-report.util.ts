import { esc, openPrintWindow, section, th } from '../../core/utils/print-report.util';
import { formatStudentCode } from '../../core/utils/student-code.util';
import { EducationalBooksCourseDetail } from '@shared/interfaces/course-product.interface';

/**
 * The paper answer to "who paid for the book?" — printed from the books list
 * (one course, or every course) and from a course's own page, optionally
 * narrowed to one class. The print window doubles as the save-as-PDF path,
 * which is why this is plain HTML (see print-report.util).
 */
export function printBooksReport(opts: {
  details: EducationalBooksCourseDetail[];
  /** Narrow the buyers to one class (id); null/undefined = every class. */
  classId?: string | null;
  /** The chosen class's display name, for the page subtitle. */
  className?: string | null;
  t: (key: string, params?: object) => string;
  rtl: boolean;
}): void {
  const { details, classId, className, t, rtl } = opts;
  const locale = rtl ? 'ar-EG' : 'en-US';
  const fmtDate = (d: string) => new Date(d).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });

  const head = th([
    [t('EDUCATIONAL_BOOKS.REPORT_COL_CODE'), false],
    [t('EDUCATIONAL_BOOKS.REPORT_COL_STUDENT'), false],
    [t('EDUCATIONAL_BOOKS.REPORT_COL_CLASS'), false],
    [t('EDUCATIONAL_BOOKS.REPORT_COL_QTY'), true],
    [t('EDUCATIONAL_BOOKS.REPORT_COL_AMOUNT'), true],
    [t('EDUCATIONAL_BOOKS.REPORT_COL_DATE'), true],
  ]);

  let sections = '';
  let grandTotal = 0;
  let grandBuyers = 0;

  for (const detail of details) {
    for (const product of detail.products) {
      const buyers = product.buyers
        .filter((b) => !classId || b.classId === classId)
        .sort((a, z) => (a.studentName || '').localeCompare(z.studentName || ''));
      if (!buyers.length) continue;

      const total = buyers.reduce((sum, b) => sum + (b.totalAmount - (b.totalRefunded || 0)), 0);
      grandTotal += total;
      grandBuyers += buyers.length;

      const rows = buyers.map((b) => `
        <tr>
          <td>${b.studentCode != null ? esc(formatStudentCode(b.studentCode)) : ''}</td>
          <td>${esc(b.studentName || '')}</td>
          <td>${esc(b.className || '')}</td>
          <td class="num">${b.quantity}</td>
          <td class="num">${(b.totalAmount - (b.totalRefunded || 0)).toLocaleString(locale)}</td>
          <td class="num">${esc(fmtDate(b.saleDate))}</td>
        </tr>`).join('');
      const foot = `
        <tfoot><tr>
          <td colspan="4">${esc(t('EDUCATIONAL_BOOKS.REPORT_TOTAL'))} (${buyers.length})</td>
          <td class="num">${total.toLocaleString(locale)}</td>
          <td></td>
        </tr></tfoot>`;

      sections += section(
        `${detail.courseName} — ${product.productName}`,
        head, rows, '', foot,
      );
    }
  }

  const scope = [
    details.length === 1 ? details[0].courseName : t('EDUCATIONAL_BOOKS.REPORT_ALL_COURSES'),
    classId ? className || '' : '',
    new Date().toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }),
  ].filter(Boolean).join(' · ');

  openPrintWindow({
    title: t('EDUCATIONAL_BOOKS.REPORT_TITLE'),
    rtl,
    body: `
      <h1>${esc(t('EDUCATIONAL_BOOKS.REPORT_TITLE'))}</h1>
      <div class="meta">${esc(scope)} · ${esc(t('EDUCATIONAL_BOOKS.REPORT_TOTAL'))}: ${grandBuyers} — ${grandTotal.toLocaleString(locale)}</div>
      ${sections || `<p class="empty">${esc(t('EDUCATIONAL_BOOKS.REPORT_EMPTY'))}</p>`}`,
  });
}
