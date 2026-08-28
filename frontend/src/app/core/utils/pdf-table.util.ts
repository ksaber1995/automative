import { esc } from './print-report.util';

/**
 * Download a titled table as a real .pdf file — the app-wide way (extracted
 * from the students export, which now delegates here).
 *
 * The pages are rendered as HTML and captured with html2canvas rather than
 * drawn with the PDF library's own text calls. That is deliberate: this app is
 * Arabic-first, and the JS PDF text APIs do not shape or reorder Arabic — names
 * come out as disconnected, backwards glyphs unless a full Arabic font is
 * embedded, and even then the joining is wrong. The browser already shapes the
 * exact same markup correctly on screen, so we let it do the typesetting and
 * put the result in the PDF. The trade-off is that the text is an image, not
 * selectable; correct names matter more than selectable ones here.
 *
 * Rows are measured first and grouped into pages so nothing is sliced through
 * the middle, and every page repeats the table header.
 */

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

export async function downloadTablePdf(opts: {
  headers: string[];
  /** One array per row, one string per column — already formatted for print. */
  body: string[][];
  /**
   * Column indexes forced LTR when the page is RTL: codes, phones, anything
   * whose digits the bidi algorithm would reorder next to Arabic text.
   */
  ltrColumns?: number[];
  title: string;
  subtitle: string;
  filename: string;
  rtl: boolean;
}): Promise<void> {
  const { headers, body, title, subtitle, filename, rtl } = opts;
  const ltr = new Set(opts.ltrColumns ?? []);

  // Loaded on demand: together these are ~600 KB, and most sessions never export.
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const headHtml = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const titleHtml = `<h1>${esc(title)}</h1><div class="meta">${esc(subtitle)}</div>`;
  const rowHtml = (r: string[]) => `<tr>${r.map((c, i) =>
    `<td${ltr.has(i) && rtl ? ' dir="ltr" style="text-align:right"' : ''}>${esc(c)}</td>`
  ).join('')}</tr>`;

  const stage = makeStage(rtl);
  try {
    // Pass 1 — measure. One table with every row, to learn each row's real
    // height (a long name wraps, so they are not uniform).
    const probe = document.createElement('div');
    probe.className = 'pg';
    probe.innerHTML = `${titleHtml}<table><thead>${headHtml}</thead><tbody>${body.map(rowHtml).join('')}</tbody></table>`;
    stage.appendChild(probe);

    const titleH = (probe.querySelector('table') as HTMLElement).offsetTop;
    const theadH = (probe.querySelector('thead') as HTMLElement).offsetHeight;
    const rowHeights = Array.from(probe.querySelectorAll('tbody tr')).map((tr) => (tr as HTMLElement).offsetHeight);
    stage.removeChild(probe);

    // Group rows into pages. Page 1 also carries the title block.
    const pages: string[][][] = [];
    let current: string[][] = [];
    let used = titleH + theadH;
    for (let i = 0; i < body.length; i++) {
      const h = rowHeights[i] || 24;
      if (current.length && used + h > CONTENT_H_PX) {
        pages.push(current);
        current = [];
        used = theadH; // later pages repeat the header but not the title
      }
      current.push(body[i]);
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
        + `<table><thead>${headHtml}</thead><tbody>${pages[p].map(rowHtml).join('')}</tbody></table>`;
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
