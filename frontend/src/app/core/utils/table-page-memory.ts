import { WritableSignal, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Pagination that survives leaving the page.
 *
 * The position lives in TWO places, because it is lost two different ways:
 * the URL (?page=3) covers deep links and the browser's Back button, and
 * sessionStorage covers the app's own navigations back to the page — a save
 * or a back button routes to the bare path, dropping every query param.
 * Restoring: the URL wins when it says anything; the session copy fills in
 * when it does not. So editing a row on page 7 returns to page 7.
 *
 * One instance per table; two tables on one page use distinct param names.
 * Bind `[first]="mem.first()"`, `[rows]="mem.rows()"`, `(onPage)="mem.onPage($event)"`.
 */
export class TablePageMemory {
  first = signal(0);
  rows: WritableSignal<number>;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private opts: {
      /** sessionStorage key — unique per table across the app. */
      storeKey: string;
      defaultRows: number;
      /** The table's rowsPerPageOptions; anything else in the URL is ignored. */
      allowedRows: number[];
      pageParam?: string;
      rowsParam?: string;
    },
  ) {
    this.rows = signal(opts.defaultRows);
    const qp = route.snapshot.queryParamMap;
    let page = parseInt(qp.get(this.pageParam) ?? '', 10);
    let rows = parseInt(qp.get(this.rowsParam) ?? '', 10);
    if (!Number.isFinite(page)) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(opts.storeKey) ?? 'null');
        if (saved) {
          page = saved.page;
          rows = Number.isFinite(rows) ? rows : saved.rows;
        }
      } catch { /* a corrupt entry restores nothing */ }
    }
    if (opts.allowedRows.includes(rows)) this.rows.set(rows);
    if (Number.isFinite(page) && page > 1) this.first.set((page - 1) * this.rows());
  }

  private get pageParam() { return this.opts.pageParam ?? 'page'; }
  private get rowsParam() { return this.opts.rowsParam ?? 'rows'; }

  onPage(e: { first: number; rows: number }): void {
    this.first.set(e.first);
    this.rows.set(e.rows);
    const page = Math.floor(e.first / e.rows) + 1;
    try {
      sessionStorage.setItem(this.opts.storeKey, JSON.stringify({ page, rows: e.rows }));
    } catch { /* private mode — the URL still carries it */ }
    // replaceUrl: paging is one position, not a trail of history entries.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [this.pageParam]: page > 1 ? page : null,
        [this.rowsParam]: e.rows !== this.opts.defaultRows ? e.rows : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
