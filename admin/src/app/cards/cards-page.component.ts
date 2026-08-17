import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardsService } from './cards.service';
import { ClientRow, SortKey, SortState } from './models';
import { KpiTileComponent } from './kpi-tile.component';
import { PoolBarComponent } from './pool-bar.component';
import { ClientTableComponent } from './client-table.component';
import { ClientDrawerComponent } from './client-drawer.component';

/**
 * The Cards section: KPIs, the pool bar, the client table, and the per-client
 * sheet stacked over the top.
 *
 * Ported from the standalone `cards/` app, where picking a client was a route
 * (/client/:id). This console has no router — its sections are a signal on the
 * sidebar — so selection is a signal here and the sheet renders inline. The
 * sheet component itself is untouched: it already took a client and emitted
 * close, which is all either host needs to supply.
 *
 * Everything is wrapped in `.cards-scope`, which is where the report's design
 * tokens live (see styles.css). They are scoped rather than global so the rest
 * of the console keeps its own palette.
 */
@Component({
  selector: 'app-cards-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, DecimalPipe,
    KpiTileComponent, PoolBarComponent, ClientTableComponent, ClientDrawerComponent,
  ],
  template: `
    <div class="cards-scope">
      <div class="wrap">
        <header>
          <div>
            <h1>Cards</h1>
            <div class="sub">Cards generated per active (paying) client, and the QR pool split (linked vs unlinked).</div>
          </div>
          <div class="controls">
            <input
              type="search" class="search" placeholder="Search clients…"
              autocomplete="off" spellcheck="false"
              [ngModel]="search()" (ngModelChange)="search.set($event)"
            />
            <select class="pick" [ngModel]="typeFilter()" (ngModelChange)="typeFilter.set($event)" title="Account type">
              <option value="ALL">All types</option>
              <option value="ACADEMY">Academy</option>
              <option value="TEACHER">Teacher</option>
            </select>
            <label class="toggle">
              <input type="checkbox" [ngModel]="onlyWithCards()" (ngModelChange)="onlyWithCards.set($event)" />
              Only clients with cards
            </label>
            <label class="toggle" title="Cards minted but not yet sent to the printer">
              <input type="checkbox" [ngModel]="needsPrinting()" (ngModelChange)="needsPrinting.set($event)" />
              Needs printing
            </label>
            <label class="toggle" title="Every card in the pool is handed out — they need a new run">
              <input type="checkbox" [ngModel]="poolExhausted()" (ngModelChange)="poolExhausted.set($event)" />
              Pool exhausted
            </label>
            @if (filtersActive() || search().trim()) {
              <button class="linkish" (click)="clearFilters()">Clear filters</button>
            }
            <button class="refresh" [disabled]="loading()" (click)="load()">Refresh</button>
          </div>
        </header>

        @if (!loading() && !error()) {
          <section class="kpis">
            <app-kpi-tile label="Active clients" [value]="(rows().length | number) ?? '0'" [note]="clientsNote()" />
            <app-kpi-tile label="Cards generated" [value]="(sums().total | number) ?? '0'" note="across the QR pool" />
            <app-kpi-tile label="Linked" [value]="(sums().linked | number) ?? '0'" [note]="linkedNote()" />
            <app-kpi-tile label="Unlinked" [value]="(sums().unlinked | number) ?? '0'" note="still in the pool" />
          </section>

          <section class="poolbar-wrap">
            <div class="poolbar-head">
              <span class="t">QR pool</span>
              <span class="legend">
                <span><span class="dot l"></span>Linked</span>
                <span><span class="dot u"></span>Unlinked</span>
              </span>
            </div>
            <app-pool-bar [linked]="sums().linked" [unlinked]="sums().unlinked" />
          </section>

          @if (shown().length) {
            <app-client-table
              [rows]="shown()" [sort]="sort()"
              (sortBy)="toggleSort($event)" (select)="open($event)"
            />
          }
        }

        @if (loading()) {
          <div class="state">{{ loadingMessage() }}</div>
        } @else if (error(); as e) {
          <div class="state err">
            Could not load: {{ e }}.
            If this is a CORS error, serve the console on http://localhost:4300 (see README).
          </div>
        } @else if (!shown().length) {
          <div class="state">
            @if (search().trim()) { No clients match “{{ search().trim() }}”. }
            @else { No clients to show with the current filters. }
            @if (filtersActive() || search().trim()) {
              <button class="linkish" (click)="clearFilters()">Clear filters</button>
            }
          </div>
        }

        @if (updatedAt(); as t) {
          <div class="foot">
            Active (paying) clients only. Cards generated = size of a client's QR pool; linked = handed out to a
            student, unlinked = still free. Source: <span class="off">/api/karim-admin-secret</span>. Updated {{ t }}.
          </div>
        }
      </div>

      <!-- Full-screen, over the console's sidebar as well: while a print run is
           being prepared this is the whole screen. Escape or × comes back. -->
      @if (selected(); as c) {
        <app-client-drawer [client]="c" (close)="closeSheet()" (changed)="refreshSelected()" />
      }
    </div>
  `,
  styles: [`
    /* No max-width or padding of its own — the console's <main> already pads,
       and the other sections run full width. */
    .wrap { padding: 0; }

    header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    h1 { font-size: 24px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
    .sub { color: var(--text-2); font-size: 13px; margin-top: 2px; }
    .controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); cursor: pointer; user-select: none; }
    .search {
      font: inherit; color: var(--text); background: var(--surface);
      border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; width: 220px; max-width: 60vw;
    }
    .search::placeholder { color: var(--muted); }
    .search:focus { outline: none; border-color: var(--linked); }
    button.refresh {
      font: inherit; color: var(--text); background: var(--surface);
      border: 1px solid var(--border); border-radius: 8px; padding: 6px 14px; cursor: pointer;
    }
    button.refresh:hover { border-color: var(--muted); }
    button.refresh:disabled { opacity: .5; cursor: default; }

    .pick {
      font: inherit; color: var(--text); background: var(--surface);
      border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; cursor: pointer;
    }
    .pick:focus { outline: none; border-color: var(--linked); }
    button.linkish {
      font: inherit; color: var(--linked); background: none; border: none;
      padding: 0; cursor: pointer; text-decoration: underline;
    }
    .state button.linkish { margin-left: 6px; }

    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 26px 0 10px; }
    @media (max-width: 720px) { .kpis { grid-template-columns: repeat(2, 1fr); } }

    .poolbar-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; margin-top: 14px; box-shadow: var(--shadow); }
    .poolbar-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
    .poolbar-head .t { font-size: 13px; font-weight: 600; }

    .state { padding: 40px 16px; text-align: center; color: var(--text-2); }
    .state.err { color: var(--danger); }
    .foot { margin-top: 18px; color: var(--muted); font-size: 12px; }
  `],
})
export class CardsPageComponent {
  private service = inject(CardsService);

  protected rows = signal<ClientRow[]>([]);
  protected loading = signal(true);
  protected loadingMessage = signal('Loading clients…');
  protected error = signal<string | null>(null);
  protected updatedAt = signal<string | null>(null);

  /** The client whose sheet is open; null is the report on its own. */
  protected selected = signal<ClientRow | null>(null);

  protected search = signal('');
  protected onlyWithCards = signal(true);
  /** 'ALL', or one of the values company_type actually holds. */
  protected typeFilter = signal<'ALL' | 'ACADEMY' | 'TEACHER'>('ALL');
  /** Cards minted but not yet sent to the printer — the work queue. */
  protected needsPrinting = signal(false);
  /** Whole pool handed out, so the client needs a new run minted. */
  protected poolExhausted = signal(false);
  protected sort = signal<SortState>({ key: 'total', dir: -1 });

  /** Any filter beyond the default is on — drives the empty-state wording. */
  protected filtersActive = computed(() =>
    this.typeFilter() !== 'ALL' || this.needsPrinting() || this.poolExhausted() || !this.onlyWithCards(),
  );

  protected clearFilters(): void {
    this.search.set('');
    this.typeFilter.set('ALL');
    this.needsPrinting.set(false);
    this.poolExhausted.set(false);
    this.onlyWithCards.set(true);
  }

  /** Rows after the filter + search + sort the user has chosen. */
  protected shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    let list = this.onlyWithCards() ? this.rows().filter((r) => r.total > 0) : [...this.rows()];

    const type = this.typeFilter();
    if (type !== 'ALL') list = list.filter((r) => r.type === type);

    if (this.needsPrinting()) list = list.filter((r) => r.unprinted > 0);

    // A client with no cards at all has not exhausted anything — `total > 0`
    // keeps an empty pool out of a list that means "mint them some more".
    if (this.poolExhausted()) list = list.filter((r) => r.total > 0 && r.unlinked === 0);

    if (q) {
      list = list.filter((r) =>
        [r.name, r.type, r.ownerEmail, r.mobile].some((f) => String(f ?? '').toLowerCase().includes(q)),
      );
    }

    const { key, dir } = this.sort();
    return list.sort((a, b) => {
      const A = a[key];
      const B = b[key];
      const cmp = typeof A === 'string' && typeof B === 'string' ? A.localeCompare(B) : Number(A) - Number(B);
      return cmp * dir;
    });
  });

  /** Totals track the visible set, so they agree with the table footer. */
  protected sums = computed(() =>
    this.shown().reduce(
      (a, r) => ({ total: a.total + r.total, linked: a.linked + r.linked, unlinked: a.unlinked + r.unlinked }),
      { total: 0, linked: 0, unlinked: 0 },
    ),
  );

  protected clientsNote = computed(() => `${this.rows().filter((r) => r.total > 0).length.toLocaleString()} with cards`);

  protected linkedNote = computed(() => {
    const { total, linked } = this.sums();
    return total ? `${Math.round((linked / total) * 100)}% of pool` : '';
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.loadingMessage.set('Loading clients…');

    this.service.loadActiveClients().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.updatedAt.set(new Date().toLocaleTimeString());
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(err instanceof Error ? err.message : String(err));
        this.loading.set(false);
      },
    });
  }

  /** Picking a client opens the sheet over the report. */
  protected open(row: ClientRow): void {
    this.selected.set(row);
  }

  protected closeSheet(): void {
    this.selected.set(null);
  }

  /**
   * Re-read just the open client after a mint, a print-mark or an address save.
   * One client, not the whole report — `loadActiveClients` fans out a card-stats
   * call per active tenant, and only this one has changed. The row behind is
   * patched from the same result so the table agrees with the sheet.
   */
  protected refreshSelected(): void {
    const current = this.selected();
    if (!current) return;
    this.service.loadClient(current.id).subscribe({
      next: (row) => {
        if (!row) return;
        this.selected.set(row);
        this.rows.update((list) => list.map((r) => (r.id === row.id ? row : r)));
      },
    });
  }

  /** Same column flips direction; a new column starts ascending for text, descending for numbers. */
  protected toggleSort(key: SortKey): void {
    this.sort.update((s) =>
      s.key === key
        ? { key, dir: (s.dir * -1) as 1 | -1 }
        : { key, dir: key === 'name' || key === 'type' ? 1 : -1 },
    );
  }
}
