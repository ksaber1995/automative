import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CardsService } from './cards.service';
import { CardRequestRow } from './models';

/**
 * The card-requests inbox: tenants ask for a new run from their own QR-cards
 * page, and this is where those asks get answered. Accepting records the
 * decision only — the run itself is still minted on the client's sheet, where
 * serials and price are chosen — so each row links to that sheet.
 *
 * Renders nothing at all while there are no requests: most days this inbox is
 * empty and the report should not carry an empty box around it.
 */
@Component({
  selector: 'app-card-requests',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    @if (requests().length) {
      <section class="inbox">
        <div class="head">
          <span class="t">
            Card requests
            @if (pending().length) { <span class="badge">{{ pending().length }} pending</span> }
          </span>
          @if (decided().length) {
            <button class="linkish" (click)="showHistory.set(!showHistory())">
              {{ showHistory() ? 'Hide history' : 'History (' + decided().length + ')' }}
            </button>
          }
        </div>

        @for (r of pending(); track r.id) {
          <div class="row">
            <div class="who">
              <button class="name" (click)="openClient.emit(r.companyId)" title="Open this client's cards sheet">
                {{ r.companyName }}
              </button>
              <span class="meta">
                {{ r.createdAt | date: 'MMM d, y' }}
                @if (r.requestedByEmail) { · {{ r.requestedByEmail }} }
                @if (r.companyAddress) { · {{ r.companyAddress }} }
              </span>
              @if (r.notes) { <span class="notes">“{{ r.notes }}”</span> }
            </div>
            <span class="count">{{ r.count }} cards</span>
            <div class="actions">
              <button class="accept" [disabled]="deciding() === r.id" (click)="decide(r, true)">Accept</button>
              <button class="refuse" [disabled]="deciding() === r.id" (click)="decide(r, false)">Refuse</button>
            </div>
          </div>
        }

        @if (showHistory()) {
          @for (r of decided(); track r.id) {
            <div class="row done">
              <div class="who">
                <button class="name" (click)="openClient.emit(r.companyId)">{{ r.companyName }}</button>
                <span class="meta">asked {{ r.createdAt | date: 'MMM d, y' }} · decided {{ r.decidedAt | date: 'MMM d, y' }}</span>
                @if (r.notes) { <span class="notes">“{{ r.notes }}”</span> }
              </div>
              <span class="count">{{ r.count }} cards</span>
              <span class="chip" [class.ok]="r.status === 'ACCEPTED'" [class.no]="r.status === 'REFUSED'">
                {{ r.status === 'ACCEPTED' ? 'Accepted' : 'Refused' }}
              </span>
            </div>
          }
        }

        @if (error(); as e) { <div class="err">{{ e }}</div> }
      </section>
    }
  `,
  styles: [`
    .inbox {
      background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
      padding: 14px 18px; margin-top: 16px; box-shadow: var(--shadow);
    }
    .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
    .t { font-size: 13px; font-weight: 600; }
    .badge {
      margin-left: 8px; font-size: 12px; font-weight: 600; color: #92400e;
      background: #fef3c7; border-radius: 999px; padding: 2px 10px;
    }
    .row {
      display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
      padding: 10px 0; border-top: 1px solid var(--border);
    }
    .row.done { opacity: .75; }
    .who { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    button.name {
      font: inherit; font-weight: 600; color: var(--text); background: none; border: none;
      padding: 0; cursor: pointer; text-align: start; text-decoration: underline; text-decoration-color: var(--border);
    }
    button.name:hover { text-decoration-color: var(--text-2); }
    .meta { color: var(--text-2); font-size: 12px; }
    .notes { color: var(--text-2); font-size: 12px; font-style: italic; }
    .count { font-weight: 650; white-space: nowrap; }
    .actions { display: flex; gap: 8px; }
    .actions button {
      font: inherit; border-radius: 8px; padding: 5px 14px; cursor: pointer; border: 1px solid transparent;
    }
    .actions button:disabled { opacity: .5; cursor: default; }
    button.accept { color: #fff; background: #16a34a; }
    button.accept:hover:enabled { background: #15803d; }
    button.refuse { color: var(--danger); background: none; border-color: var(--border); }
    button.refuse:hover:enabled { border-color: var(--danger); }
    .chip { font-size: 12px; font-weight: 600; border-radius: 999px; padding: 2px 10px; }
    .chip.ok { color: #166534; background: #dcfce7; }
    .chip.no { color: #991b1b; background: #fee2e2; }
    button.linkish {
      font: inherit; font-size: 12px; color: var(--text-2); background: none; border: none;
      padding: 0; cursor: pointer; text-decoration: underline;
    }
    .err { color: var(--danger); font-size: 12px; padding-top: 8px; }
  `],
})
export class CardRequestsComponent {
  private service = inject(CardsService);

  /** Asks the host to open this client's sheet (where the run gets minted). */
  openClient = output<string>();

  protected requests = signal<CardRequestRow[]>([]);
  protected deciding = signal<string | null>(null);
  protected error = signal<string | null>(null);
  protected showHistory = signal(false);

  protected pending = computed(() => this.requests().filter((r) => r.status === 'PENDING'));
  protected decided = computed(() => this.requests().filter((r) => r.status !== 'PENDING'));

  constructor() {
    this.load();
  }

  load(): void {
    this.service.listCardRequests().subscribe({
      next: (rows) => this.requests.set(rows),
      // Silently absent rather than broken: the inbox decorates the report.
      error: () => this.requests.set([]),
    });
  }

  protected decide(row: CardRequestRow, accept: boolean): void {
    if (!accept && !confirm(`Refuse ${row.companyName}'s request for ${row.count} cards?`)) return;
    this.deciding.set(row.id);
    this.error.set(null);
    this.service.decideCardRequest(row.id, accept).subscribe({
      next: () => {
        this.deciding.set(null);
        this.load();
        // Accepting means the run gets minted next — put the owner on the sheet
        // where that happens instead of leaving it as homework.
        if (accept) this.openClient.emit(row.companyId);
      },
      error: (err: unknown) => {
        this.deciding.set(null);
        this.error.set(err instanceof Error ? err.message : 'Could not save the decision');
        // A 409 means someone else already decided it — reload shows the truth.
        this.load();
      },
    });
  }
}
