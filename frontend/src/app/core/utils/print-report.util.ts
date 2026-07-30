/**
 * The shared look for anything this app prints — the salary reports, the
 * students export — so they read as one house style rather than drifting apart.
 *
 * A popup window rather than window.print() on the page: every caller lives
 * inside the app shell, so printing in place would carry the sidebar and header
 * onto the paper. It doubles as the "save as PDF" path, which is why the pages
 * are built from ordinary HTML — the browser shapes Arabic correctly, where a
 * JS PDF library needs a whole embedded font to come close.
 */

/** Report content is user data — a student named with an "&" must not become markup. */
export function esc(s: string | number | null | undefined): string {
  return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
}

/** A headline tile: label over a big number, with an optional footnote. */
export function kpi(label: string, value: string, note = ''): string {
  return `
    <div class="kpi">
      <div class="kpi-l">${esc(label)}</div>
      <div class="kpi-v">${esc(value)}</div>
      ${note ? `<div class="kpi-n">${esc(note)}</div>` : ''}
    </div>`;
}

/** A table header row from [label, isNumeric] pairs. */
export function th(labels: [string, boolean][]): string {
  return labels.map(([l, num]) => `<th class="${num ? 'num' : ''}">${esc(l)}</th>`).join('');
}

/** A titled table, or the empty message when there are no rows to show. An
 *  empty title omits the heading — for a page whose <h1> already said it. */
export function section(title: string, head: string, body: string, empty: string, foot = ''): string {
  return (title ? `<h2>${esc(title)}</h2>` : '') + (body
    ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`
    : `<p class="empty">${esc(empty)}</p>`);
}

export function openPrintWindow(opts: { title: string; rtl: boolean; body: string; landscape?: boolean }): void {
  const { title, rtl, body, landscape } = opts;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;

  w.document.write(`
    <html dir="${rtl ? 'rtl' : 'ltr'}">
      <head>
        <meta charset="utf-8" />
        <title>${esc(title)}</title>
        <style>
          @page { margin: ${landscape ? '10mm' : '14mm'}; ${landscape ? 'size: landscape;' : ''} }
          * { box-sizing: border-box; }
          body { font-family: system-ui, "Segoe UI", Tahoma, sans-serif; color: #111827; margin: 0; font-size: 11px; }
          h1 { font-size: 18px; margin: 0; }
          h2 { font-size: 13px; margin: 18px 0 6px; }
          .meta { color: #6b7280; font-size: 11px; margin: 2px 0 14px; }
          .kpis { display: flex; flex-wrap: wrap; gap: 8px; }
          .kpi { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; min-width: 120px; }
          .kpi-l { color: #6b7280; font-size: 9px; text-transform: uppercase; }
          .kpi-v { font-size: 15px; font-weight: 700; }
          .kpi-n { color: #9ca3af; font-size: 9px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; text-align: ${rtl ? 'right' : 'left'}; vertical-align: top; }
          th { background: #f9fafb; font-size: 9px; text-transform: uppercase; color: #4b5563; }
          .num { text-align: ${rtl ? 'left' : 'right'}; white-space: nowrap; }
          .sub { color: #9ca3af; font-size: 9px; }
          tfoot td { font-weight: 700; background: #f9fafb; }
          .empty { color: #6b7280; }
          /* The arithmetic strip: base + bonus − discount = paid. */
          .calc { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; margin-top: 6px; }
          .calc-row { display: flex; justify-content: space-between; padding: 2px 0; }
          .calc-row.total { border-top: 1px solid #e5e7eb; margin-top: 4px; padding-top: 5px; font-weight: 700; font-size: 13px; }
          /* Keep a row whole and repeat the header when a table spans pages. */
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
        </style>
      </head>
      <body>${body}</body>
    </html>`);
  w.document.close();
  w.focus();
  // A tick for layout, or the print dialog opens over a half-laid-out document.
  setTimeout(() => w.print(), 300);
}
