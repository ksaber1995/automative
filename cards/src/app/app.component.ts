import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardsService } from './cards.service';
import { ClientRow, SortKey, SortState } from './models';
import { KpiTileComponent } from './kpi-tile.component';
import { PoolBarComponent } from './pool-bar.component';
import { ClientTableComponent } from './client-table.component';
import { ClientDrawerComponent } from './client-drawer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, DecimalPipe,
    KpiTileComponent, PoolBarComponent, ClientTableComponent, ClientDrawerComponent,
  ],
  template: `
    <div class="wrap">
      <header>
        <div>
          <h1>Cards · per-client report</h1>
          <div class="sub">Cards generated per active (paying) client, and the QR pool split (linked vs unlinked).</div>
        </div>
        <div class="controls">
          <input
            type="search" class="search" placeholder="Search clients…"
            autocomplete="off" spellcheck="false"
            [ngModel]="search()" (ngModelChange)="search.set($event)"
          />
          <label class="toggle">
            <input type="checkbox" [ngModel]="onlyWithCards()" (ngModelChange)="onlyWithCards.set($event)" />
            Only clients with cards
          </label>
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
            (sortBy)="toggleSort($event)" (select)="selected.set($event)"
          />
        }
      }

      @if (loading()) {
        <div class="state">{{ loadingMessage() }}</div>
      } @else if (error(); as e) {
        <div class="state err">
          Could not load: {{ e }}.
          If this is a CORS error, serve the page on http://localhost:4800 (see README).
        </div>
      } @else if (!shown().length) {
        <div class="state">
          @if (search().trim()) { No clients match “{{ search().trim() }}”. }
          @else { No clients to show with the current filter. }
        </div>
      }

      @if (updatedAt(); as t) {
        <div class="foot">
          Active (paying) clients only. Cards generated = size of a client's QR pool; linked = handed out to a
          student, unlinked = still free. Source: <span class="off">/api/karim-admin-secret</span>. Updated {{ t }}.
        </div>
      }
    </div>

    <app-client-drawer [client]="selected()" (close)="selected.set(null)" />
  `,
  styles: [`
    .wrap { max-width: 1040px; margin: 0 auto; padding: 32px 24px 64px; }

    header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    h1 { font-size: 20px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
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
export class AppComponent {
  private service = inject(CardsService);

  protected rows = signal<ClientRow[]>([]);
  protected loading = signal(true);
  protected loadingMessage = signal('Loading clients…');
  protected error = signal<string | null>(null);
  protected updatedAt = signal<string | null>(null);

  protected search = signal('');
  protected onlyWithCards = signal(true);
  protected sort = signal<SortState>({ key: 'total', dir: -1 });
  protected selected = signal<ClientRow | null>(null);

  /** Rows after the filter + search + sort the user has chosen. */
  protected shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    let list = this.onlyWithCards() ? this.rows().filter((r) => r.total > 0) : [...this.rows()];

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

  /** Same column flips direction; a new column starts ascending for text, descending for numbers. */
  protected toggleSort(key: SortKey): void {
    this.sort.update((s) =>
      s.key === key
        ? { key, dir: (s.dir * -1) as 1 | -1 }
        : { key, dir: key === 'name' || key === 'type' ? 1 : -1 },
    );
  }
}
