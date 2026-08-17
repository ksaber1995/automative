import { Injectable, computed, inject, signal } from '@angular/core';
import { CompanySubscription, PoolBot, SubscriptionsService, TenantUser } from './subscriptions.service';

/**
 * The data more than one screen needs.
 *
 * When every section lived in AppComponent this was just fields on that class.
 * Now that they are routes, three of them still share state: the sidebar shows a
 * count for each section without opening it, the Users page needs the tenant
 * list for its "which tenant" pickers, and the Cards badge is derived from the
 * same company list the Companies table renders. Fetching that list once, here,
 * beats each route fetching its own copy of 115 tenants.
 *
 * Loads are idempotent by default — `load()` on a route that already has data is
 * a no-op, so moving between sections does not re-fetch. Pass `force` (what the
 * Refresh buttons do) to actually go and look again.
 */
@Injectable({ providedIn: 'root' })
export class AdminStore {
  private service = inject(SubscriptionsService);

  // ── Tenants ────────────────────────────────────────────────────────────────
  readonly companies = signal<CompanySubscription[]>([]);
  readonly companiesLoading = signal(false);
  readonly companiesError = signal<string | null>(null);

  // ── Tenant user accounts ───────────────────────────────────────────────────
  readonly users = signal<TenantUser[]>([]);
  readonly usersLoading = signal(false);
  readonly usersError = signal<string | null>(null);

  // ── Telegram bot pool ──────────────────────────────────────────────────────
  readonly bots = signal<PoolBot[]>([]);
  readonly poolTotal = signal(0);
  readonly poolAvailable = signal(0);

  /** The Cards badge: tenants on a paying subscription — what that report lists. */
  readonly activeClientCount = computed(
    () => this.companies().filter((r) => (r.subscription_type || '').toUpperCase() === 'ACTIVE').length,
  );

  /** How many tenants carry a given subscription_type — the Companies filter pills. */
  statusCount(status: string): number {
    return this.companies().filter((r) => (r.subscription_type || '').toUpperCase() === status).length;
  }

  // ── The toast ──────────────────────────────────────────────────────────────
  // One instance, rendered by the shell, so a message survives the navigation
  // that follows the action which produced it.
  readonly flash = signal<string | null>(null);
  private flashTimer?: ReturnType<typeof setTimeout>;

  showFlash(message: string): void {
    this.flash.set(message);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 3500);
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  loadCompanies(force = false): void {
    if (this.companiesLoading()) return;
    if (!force && this.companies().length) return;
    this.companiesLoading.set(true);
    this.companiesError.set(null);
    this.service.getAll().subscribe({
      next: (data) => {
        this.companies.set(data);
        this.companiesLoading.set(false);
      },
      error: (err) => {
        this.companiesLoading.set(false);
        this.companiesError.set(
          `Could not load subscriptions: ${err?.error?.message || err?.message || 'Request failed'}`,
        );
      },
    });
  }

  loadUsers(force = false): void {
    if (this.usersLoading()) return;
    if (!force && this.users().length) return;
    this.usersLoading.set(true);
    this.usersError.set(null);
    this.service.listUsers().subscribe({
      next: (rows) => {
        this.users.set(rows);
        this.usersLoading.set(false);
      },
      error: (err) => {
        this.usersLoading.set(false);
        this.usersError.set(`Users: ${err?.error?.message || err?.message || 'Request failed'}`);
      },
    });
  }

  loadBots(force = false): void {
    if (!force && this.bots().length) return;
    this.service.listTelegramBots().subscribe({
      next: (res) => {
        this.bots.set(res.bots);
        this.poolTotal.set(res.total);
        this.poolAvailable.set(res.available);
      },
      // Quiet on purpose: the bot pool is a sidebar count for most people, and a
      // failure there must not put an error banner over whatever they opened.
      error: () => {},
    });
  }

  /** Everything the signed-in account is allowed to see. Wired to "Refresh all". */
  reset(): void {
    this.companies.set([]);
    this.users.set([]);
    this.bots.set([]);
    this.poolTotal.set(0);
    this.poolAvailable.set(0);
  }
}
