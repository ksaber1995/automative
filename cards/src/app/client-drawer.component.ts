import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PoolBarComponent } from './pool-bar.component';
import { CardsService } from './cards.service';
import { AdminQrCard, CardStatus, ClientRow } from './models';
import { CARD_SERIAL_BASE_V2, downloadCardsZip, serialLabel } from './card-export.util';

/**
 * Full-screen detail panel for one client: its pool numbers, the card list, and
 * the print workflow (mint a run → download it → mark it printed).
 *
 * Full-screen rather than the old 420px side drawer because this is now a
 * working surface, not a summary — a 500-row card table and a mint form don't
 * fit in a strip down the side of the page.
 */
@Component({
  selector: 'app-client-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, FormsModule, PoolBarComponent],
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    @if (client(); as c) {
      <div class="sheet">
        <header class="sheet-head">
          <div class="who">
            <h2>{{ c.name }}</h2>
            <div class="meta">
              <span class="badge">{{ c.type }}</span>
              <span>{{ c.subType || '—' }} subscription</span>
              @if (!c.enabled) { <span class="off">· pool off</span> }
            </div>
          </div>
          <button class="x" aria-label="Close" (click)="close.emit()">×</button>
        </header>

        <div class="sheet-body">
          <!-- ── Pool summary ─────────────────────────────────────────── -->
          <section class="grid">
            <div class="stat"><span class="l">Total cards</span><span class="v">{{ totalCount() | number }}</span></div>
            <div class="stat"><span class="l">Linked</span><span class="v">{{ linkedCount() | number }}</span></div>
            <div class="stat"><span class="l">Printed</span><span class="v">{{ printedCount() | number }}</span></div>
            <div class="stat pending"><span class="l">To print</span><span class="v">{{ unprintedCount() | number }}</span></div>
          </section>

          @if (c.total) {
            <app-pool-bar [linked]="c.linked" [unlinked]="c.unlinked" />
            <div class="legend">
              <span><span class="dot l"></span>Linked</span>
              <span><span class="dot u"></span>Unlinked</span>
            </div>
          }

          <!-- ── Where the cards go ───────────────────────────────────── -->
          <section class="panel">
            <h3>Shipping address</h3>
            <textarea
              class="addr"
              rows="3"
              maxlength="500"
              placeholder="No address set — this client's cards have nowhere to ship."
              [ngModel]="addressDraft()"
              (ngModelChange)="addressDraft.set($event)"
            ></textarea>
            <div class="actions">
              <button class="primary" [disabled]="!addressDirty() || savingAddress()" (click)="saveAddress()">
                {{ savingAddress() ? 'Saving…' : 'Save address' }}
              </button>
              @if (addressDirty() && !savingAddress()) {
                <button (click)="resetAddress()">Discard</button>
              }
              @if (addressSaved()) { <span class="progress">Saved.</span> }
            </div>
            @if (addressError(); as e) {
              <p class="hint err">{{ e }}</p>
            } @else {
              <p class="hint">
                This is the tenant's own address — they see the same value in their company profile.
                Clearing it and saving removes it.
              </p>
            }
          </section>

          <!-- ── Mint a run ───────────────────────────────────────────── -->
          <section class="panel">
            <h3>New bundle</h3>
            <div class="form">
              <label>
                <span>How many</span>
                <input type="number" min="1" max="2000" [(ngModel)]="newCount" />
              </label>
              <label>
                <span>Type</span>
                <select [(ngModel)]="newPoolType">
                  <option [ngValue]="1">Type 1</option>
                  <option [ngValue]="2">Type 2</option>
                  <option [ngValue]="3">Type 3</option>
                </select>
              </label>
              <label>
                <span>Price per card</span>
                <input type="number" min="0" step="0.01" placeholder="not recorded" [(ngModel)]="newPrice" />
              </label>
              <label>
                <span>Start at</span>
                <input type="number" min="1" max="999999" placeholder="continue" [(ngModel)]="newStartFrom" />
              </label>
              <button class="primary" [disabled]="generating()" (click)="generate()">
                {{ generating() ? 'Generating…' : 'Generate' }}
              </button>
            </div>
            @if (newPrice != null && newCount > 0) {
              <p class="hint">{{ newCount | number }} × {{ newPrice | number }} =
                <strong>{{ (newCount * newPrice) | number }}</strong> for this bundle</p>
            } @else {
              <p class="hint">Leave price empty to record nothing — that is not the same as free.</p>
            }
            @if (rangePreview(); as r) {
              <p class="hint">This run prints <strong>{{ r }}</strong>.</p>
            } @else {
              <p class="hint">Leave “start at” empty to carry on from this client's last card.</p>
            }
            @if (genError(); as e) {
              <p class="hint err">{{ e }}</p>
            }
          </section>

          <!-- ── Print workflow ───────────────────────────────────────── -->
          <section class="panel">
            <div class="panel-head">
              <h3>Cards</h3>
              <div class="tabs">
                @for (t of TABS; track t.key) {
                  <button [class.on]="view() === t.key" (click)="view.set(t.key)">{{ t.label }}</button>
                }
              </div>
            </div>

            <div class="actions">
              <button [disabled]="!cards().length || busy()" (click)="download()">
                Download {{ view() === 'unprinted' ? 'unprinted' : view() }} ({{ cards().length | number }})
              </button>
              @if (view() === 'unprinted') {
                <button class="ok" [disabled]="!cards().length || busy()" (click)="markPrinted()">
                  Mark as printed
                </button>
              }
              @if (view() === 'printed') {
                <button [disabled]="!cards().length || busy()" (click)="markUnprinted()">
                  Move back to unprinted
                </button>
              }
              @if (exporting()) {
                <span class="progress">Rendering {{ exportDone() }} / {{ exportTotal() }}…</span>
              }
            </div>

            @if (loadingCards()) {
              <p class="empty">Loading cards…</p>
            } @else if (!cards().length) {
              <p class="empty">
                @if (view() === 'unprinted') { Nothing waiting to print. Generate a bundle above. }
                @else { No cards in this view. }
              </p>
            } @else {
              <div class="tscroll">
                <table>
                  <thead>
                    <tr>
                      <th>Card</th><th>Type</th><th class="num">Price</th><th>Printed</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (card of cards().slice(0, 200); track card.id) {
                      <tr>
                        <td class="mono">{{ label(card.serial) }}</td>
                        <td>{{ card.poolType }}</td>
                        <td class="num">{{ card.price != null ? (card.price | number) : '—' }}</td>
                        <td>{{ card.printedAt ? (card.printedAt | date: 'MMM d, y') : '—' }}</td>
                        <td>{{ card.linked ? 'Linked' : 'Free' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
                @if (cards().length > 200) {
                  <p class="empty">Showing the first 200 of {{ cards().length | number }}. Download includes all of them.</p>
                }
              </div>
            }
          </section>

          <!-- ── Reference ────────────────────────────────────────────── -->
          <section class="cols">
            <div class="panel">
              <h3>Subscription</h3>
              <dl class="kv">
                <dt>Status</dt><dd>{{ c.subType || '—' }}</dd>
                <dt>Price</dt>
                <dd>@if (c.price != null) { {{ c.price | number }}{{ c.currency ? ' ' + c.currency : '' }} } @else { — }</dd>
                <dt>Started</dt><dd>{{ (c.startDate | date: 'mediumDate') || '—' }}</dd>
                <dt>Ends</dt><dd>{{ (c.endDate | date: 'mediumDate') || '—' }}</dd>
              </dl>
            </div>
            <div class="panel">
              <h3>Account</h3>
              <dl class="kv">
                <dt>Owner email</dt>
                <dd>@if (c.ownerEmail) { <a class="link" [href]="'mailto:' + c.ownerEmail">{{ c.ownerEmail }}</a> } @else { — }</dd>
                <dt>Mobile</dt><dd>{{ c.mobile || '—' }}</dd>
                <dt>Client since</dt><dd>{{ (c.createdAt | date: 'mediumDate') || '—' }}</dd>
              </dl>
            </div>
            <div class="panel">
              <h3>Usage</h3>
              <dl class="kv">
                <!-- The pair, in the same order as the table: the live roll, then
                     the all-time figure it should be read against. -->
                <dt>Active students</dt><dd>{{ c.activeStudents | number }}</dd>
                <dt>Total students</dt><dd>{{ c.students | number }}</dd>
                <dt>Courses</dt><dd>{{ c.courses | number }}</dd>
                <dt>Branches</dt><dd>{{ c.branches | number }}</dd>
                <dt>Employees</dt><dd>{{ c.employees | number }}</dd>
              </dl>
            </div>
          </section>
        </div>
      </div>
    }
  `,
  styles: [`
    .sheet {
      position: fixed; inset: 0; z-index: 60; background: var(--page);
      display: flex; flex-direction: column;
    }
    .sheet-head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      padding: 20px 28px 16px; border-bottom: 1px solid var(--grid); background: var(--surface);
    }
    .sheet-head h2 { font-size: 20px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
    .meta { color: var(--text-2); font-size: 12.5px; margin-top: 4px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .x { border: none; background: transparent; color: var(--muted); font-size: 26px; line-height: 1; cursor: pointer; padding: 2px 8px; border-radius: 6px; }
    .x:hover { color: var(--text); background: color-mix(in srgb, var(--muted) 14%, transparent); }

    .sheet-body { overflow-y: auto; padding: 22px 28px 56px; max-width: 1100px; width: 100%; margin: 0 auto; }

    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    @media (max-width: 720px) { .grid { grid-template-columns: repeat(2, 1fr); } }
    .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
    .stat .l { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .stat .v { display: block; font-size: 22px; font-weight: 650; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .stat.pending .v { color: #b26a00; }

    app-pool-bar { display: block; margin-top: 16px; }
    .legend { margin-top: 8px; }

    .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; margin-top: 18px; }
    .panel h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 0 0 12px; }
    .panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }

    .form { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
    .form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-2); }
    .form input, .form select {
      font: inherit; color: var(--text); background: var(--page);
      border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; width: 150px;
    }
    /* Mirrors .form input above, but full-width and growable — a postal address
       is two or three lines, not a 150px box. */
    .addr {
      width: 100%; box-sizing: border-box; resize: vertical;
      font: inherit; color: var(--text); background: var(--page);
      border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px;
    }
    .hint { color: var(--muted); font-size: 12px; margin: 10px 0 0; }
    /* A refused run is the one message here that must not read as a footnote. */
    .hint.err { color: #d03b3b; font-weight: 600; }

    button {
      font: inherit; color: var(--text); background: var(--page);
      border: 1px solid var(--border); border-radius: 8px; padding: 6px 14px; cursor: pointer;
    }
    button:hover:not(:disabled) { border-color: var(--muted); }
    button:disabled { opacity: .45; cursor: default; }
    button.primary { background: var(--linked); border-color: var(--linked); color: #fff; }
    button.ok { background: var(--good); border-color: var(--good); color: #fff; }

    .tabs { display: flex; gap: 6px; }
    .tabs button { padding: 4px 12px; font-size: 12.5px; }
    .tabs button.on { background: var(--linked); border-color: var(--linked); color: #fff; }

    .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
    .progress { color: var(--text-2); font-size: 12.5px; }

    .tscroll { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px 12px; text-align: left; white-space: nowrap; }
    thead th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid var(--grid); }
    tbody tr { border-bottom: 1px solid var(--grid); }
    tbody tr:last-child { border-bottom: none; }
    th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.mono { font-family: ui-monospace, monospace; font-weight: 600; }
    .empty { color: var(--muted); font-size: 13px; padding: 14px 2px; margin: 0; }

    .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
    .kv { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; font-size: 13px; margin: 0; }
    .kv dt { color: var(--text-2); }
    .kv dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  `],
})
export class ClientDrawerComponent {
  private service = inject(CardsService);

  /** null closes the sheet. */
  client = input.required<ClientRow | null>();
  close = output<void>();
  /** Fires after a mint or a print-mark so the list behind can refresh. */
  changed = output<void>();

  protected readonly TABS: { key: CardStatus; label: string }[] = [
    { key: 'unprinted', label: 'To print' },
    { key: 'printed', label: 'Printed' },
    { key: 'linked', label: 'Linked' },
    { key: 'all', label: 'All' },
  ];

  protected view = signal<CardStatus>('unprinted');
  protected cards = signal<AdminQrCard[]>([]);
  protected loadingCards = signal(false);
  protected generating = signal(false);
  protected marking = signal(false);
  protected exporting = signal(false);
  protected exportDone = signal(0);
  protected exportTotal = signal(0);

  /**
   * Live counts, refreshed after every mint/mark. All four are local signals —
   * reading total/linked straight off the input row left them frozen at whatever
   * the report last fetched, so minting a bundle showed "Total cards 0" next to
   * five freshly-created rows.
   */
  protected totalCount = signal(0);
  protected linkedCount = signal(0);
  protected printedCount = signal(0);
  protected unprintedCount = signal(0);

  protected busy = computed(() => this.generating() || this.marking() || this.exporting());

  /** Shipping address editor: draft, in-flight flag, confirmation, failure. */
  protected addressDraft = signal('');
  protected savingAddress = signal(false);
  protected addressSaved = signal(false);
  protected addressError = signal<string | null>(null);
  /** Nothing to save until the draft actually differs from what's stored. */
  protected addressDirty = computed(
    () => this.addressDraft().trim() !== (this.client()?.address ?? ''),
  );

  newCount = 100;
  newPoolType = 1;
  newPrice: number | null = null;
  /** Printed number the run starts at; null carries on from the last card. */
  newStartFrom: number | null = null;
  /** Why the last mint was refused — a taken range has to be said out loud. */
  protected genError = signal<string | null>(null);

  protected label = serialLabel;

  constructor() {
    // Re-fetch whenever the sheet opens on a client, or the tab changes.
    effect(() => {
      const c = this.client();
      const status = this.view();
      if (!c) return;
      this.totalCount.set(c.total);
      this.linkedCount.set(c.linked);
      this.printedCount.set(c.printed);
      this.unprintedCount.set(c.unprinted);
      this.loadCards(c.id, status);
    });

    // Seed the address editor from whichever client is open. Deliberately a
    // SEPARATE effect that reads only client(): folding it into the one above
    // would re-run on every tab switch and wipe a half-typed address.
    effect(() => {
      const c = this.client();
      this.addressDraft.set(c?.address ?? '');
      this.addressSaved.set(false);
      this.addressError.set(null);
    });
  }

  /** Escape closes — but not mid-export, which would look like a crash. */
  protected onEscape(): void {
    if (!this.exporting()) this.close.emit();
  }

  private loadCards(companyId: string, status: CardStatus): void {
    this.loadingCards.set(true);
    this.service.listCards(companyId, status).subscribe({
      next: (rows) => { this.cards.set(rows); this.loadingCards.set(false); },
      error: () => { this.cards.set([]); this.loadingCards.set(false); },
    });
  }

  /** Put the draft back to what's stored. */
  protected resetAddress(): void {
    this.addressDraft.set(this.client()?.address ?? '');
    this.addressError.set(null);
    this.addressSaved.set(false);
  }

  /** Save the address. Blank clears it, which the API stores as NULL. */
  protected saveAddress(): void {
    const c = this.client();
    if (!c || this.savingAddress()) return;
    this.savingAddress.set(true);
    this.addressError.set(null);
    this.addressSaved.set(false);
    this.service.setAddress(c.id, this.addressDraft().trim() || null).subscribe({
      next: () => {
        this.savingAddress.set(false);
        this.addressSaved.set(true);
        // Refresh the report behind so its Ships-to column matches.
        this.changed.emit();
      },
      error: (e: any) => {
        this.savingAddress.set(false);
        this.addressError.set(e?.error?.message || 'Could not save the address. It is unchanged.');
      },
    });
  }

  private refreshCounts(companyId: string): void {
    this.service.cardStats(companyId).subscribe({
      next: (s) => {
        this.totalCount.set(Number(s.total ?? 0));
        this.linkedCount.set(Number(s.linked ?? 0));
        this.printedCount.set(Number(s.printed ?? 0));
        this.unprintedCount.set(Number(s.unprinted ?? 0));
      },
    });
  }

  /**
   * The chosen start as a number, or null when the field is left empty (carry on
   * from the last card). Blank and nonsense both read as "not chosen".
   */
  private startNumber(): number | null {
    if (this.newStartFrom === null || String(this.newStartFrom).trim() === '') return null;
    const n = Math.floor(Number(this.newStartFrom));
    return Number.isFinite(n) && n >= 1 ? n : null;
  }

  /**
   * What this run will actually print — "0500 – 0599" — so the operator sees the
   * label, not the raw number they typed. Null while no start is chosen.
   */
  protected rangePreview(): string | null {
    const start = this.startNumber();
    const count = Math.floor(Number(this.newCount));
    if (start === null || !Number.isFinite(count) || count < 1) return null;
    const first = serialLabel(CARD_SERIAL_BASE_V2 + start);
    if (count === 1) return first;
    return `${first} – ${serialLabel(CARD_SERIAL_BASE_V2 + start + count - 1)}`;
  }

  protected generate(): void {
    const c = this.client();
    if (!c) return;
    const count = Math.floor(Number(this.newCount));
    if (!Number.isFinite(count) || count < 1 || count > 2000) return;

    this.genError.set(null);
    this.generating.set(true);
    this.service.generateCards(c.id, {
      count,
      poolType: Number(this.newPoolType) || 1,
      price: this.newPrice === null || String(this.newPrice) === '' ? null : Number(this.newPrice),
      startFrom: this.startNumber(),
    }).subscribe({
      next: () => {
        this.generating.set(false);
        // The run landed where it was asked to; a stale start would silently
        // re-mint the same window on the next click.
        this.newStartFrom = null;
        // A fresh run is unprinted, so show the tab it landed in.
        this.view.set('unprinted');
        this.loadCards(c.id, 'unprinted');
        this.refreshCounts(c.id);
        this.changed.emit();
      },
      // The server refuses a start that overlaps cards already minted — say which
      // number clashed, or the operator just sees the button stop spinning.
      error: (err) => {
        this.generating.set(false);
        this.genError.set(err?.error?.message || 'Could not generate this run.');
      },
    });
  }

  protected async download(): Promise<void> {
    const c = this.client();
    const rows = this.cards();
    if (!c || !rows.length) return;

    this.exporting.set(true);
    this.exportDone.set(0);
    this.exportTotal.set(rows.length);
    try {
      await downloadCardsZip(rows, c.name, (done, total) => {
        this.exportDone.set(done);
        this.exportTotal.set(total);
      });
    } finally {
      this.exporting.set(false);
    }
  }

  /**
   * Stamp exactly the cards currently listed — which is exactly what Download
   * exported. Marking "everything unprinted" instead would swallow a bundle
   * minted between the download and this click.
   */
  protected markPrinted(): void {
    this.setPrinted(true);
  }

  protected markUnprinted(): void {
    this.setPrinted(false);
  }

  private setPrinted(printed: boolean): void {
    const c = this.client();
    const ids = this.cards().filter((x) => !x.linked).map((x) => x.id);
    if (!c || !ids.length) return;
    if (!confirm(printed
      ? `Mark ${ids.length} card(s) as sent to the printer? They will be left out of the next download.`
      : `Move ${ids.length} card(s) back to unprinted? They will reappear in the next download.`)) return;

    this.marking.set(true);
    this.service.markPrinted(c.id, ids, printed).subscribe({
      next: () => {
        this.marking.set(false);
        this.loadCards(c.id, this.view());
        this.refreshCounts(c.id);
        this.changed.emit();
      },
      error: () => this.marking.set(false),
    });
  }
}
