import { Directive, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { Table } from 'primeng/table';

/**
 * Shared paging manners for every `p-table`, so each list does not have to
 * grow them separately:
 *
 * - the paginator renders at BOTH ends. Long pages buried "where am I?" at
 *   the bottom; the top copy answers it before any scrolling, and shows a
 *   "current / total" page report unless the table already configured one.
 * - changing page snaps the view back to the table's top. Without it the
 *   next page opens wherever the old one left the scroll — usually its foot.
 *
 * Selector is the bare `p-table`, so a component only has to IMPORT the
 * directive for every table in its template to pick this up; nothing to add
 * in the HTML. Tables without a paginator are left entirely alone.
 */
@Directive({ selector: 'p-table', standalone: true })
export class TablePageUxDirective implements OnInit, OnDestroy {
  private table = inject(Table, { self: true });
  private el = inject(ElementRef<HTMLElement>);
  private sub?: Subscription;

  ngOnInit(): void {
    if (!this.table.paginator) return;

    this.table.paginatorPosition = 'both';
    // "2 / 7" reads in any language, so no translation key to keep in four
    // files. A table that already set its own report keeps it.
    if (!this.table.showCurrentPageReport) {
      this.table.showCurrentPageReport = true;
      this.table.currentPageReportTemplate = '{currentPage} / {totalPages}';
    }

    // Keep the snap-back clear of the app's fixed header.
    this.el.nativeElement.style.scrollMarginTop = '90px';
    this.sub = this.table.onPage.subscribe(() => {
      // After the rows re-render, not before — scrolling first measures the
      // OLD page's height.
      setTimeout(() => this.el.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
