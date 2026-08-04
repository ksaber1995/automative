import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CardsService } from './cards.service';
import { ClientRow } from './models';
import { ClientDrawerComponent } from './client-drawer.component';

/**
 * The /client/:id route: loads that one tenant and hands it to the detail sheet.
 *
 * The sheet itself is unchanged — it already took a client and emitted close, so
 * routing only had to supply the client from the URL and turn "close" into a
 * navigation. That keeps a reload or a pasted link landing on the same tenant,
 * which a panel over the list could never do.
 */
@Component({
  selector: 'app-client-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ClientDrawerComponent],
  template: `
    @if (client(); as c) {
      <app-client-drawer [client]="c" (close)="back()" (changed)="reload()" />
    } @else if (loading()) {
      <div class="state">Loading client…</div>
    } @else {
      <div class="state">
        <p>{{ error() ?? 'No client with that id.' }}</p>
        <a routerLink="/">← Back to the report</a>
      </div>
    }
  `,
  styles: [`
    .state { padding: 64px 16px; text-align: center; color: var(--text-2); }
    .state p { margin: 0 0 12px; }
    .state a { color: var(--linked); text-decoration: none; }
    .state a:hover { text-decoration: underline; }
  `],
})
export class ClientDetailComponent {
  private service = inject(CardsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected client = signal<ClientRow | null>(null);
  protected loading = signal(true);
  protected error = signal<string | null>(null);

  private companyId = '';

  constructor() {
    // paramMap rather than a snapshot: Angular reuses this component when the id
    // changes, so a snapshot would leave the previous tenant on screen.
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        this.router.navigate(['/']);
        return;
      }
      this.companyId = id;
      this.reload();
    });
  }

  protected reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.loadClient(this.companyId).subscribe({
      next: (row) => {
        this.client.set(row);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.client.set(null);
        this.error.set(err instanceof Error ? err.message : String(err));
        this.loading.set(false);
      },
    });
  }

  /** Closing the sheet goes back to the report rather than blanking the page. */
  protected back(): void {
    this.router.navigate(['/']);
  }
}
