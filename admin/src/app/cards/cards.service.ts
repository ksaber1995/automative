import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, from } from 'rxjs';
import { catchError, map, mergeMap, toArray } from 'rxjs/operators';
import { ADMIN_ENDPOINT } from '../subscriptions.service';
import { AdminCompany, AdminQrCard, CardRequestRow, CardStatus, ClientRow, GenerateCardsRequest, PrintLink, QrCardStats } from './models';

/**
 * How many per-client card-pool requests to have in flight at once. This fans
 * out to one request per active client, and the endpoint shouldn't be hit with
 * all of them at once.
 */
const POOL_CONCURRENCY = 6;

@Injectable({ providedIn: 'root' })
export class CardsService {
  private http = inject(HttpClient);
  private base = ADMIN_ENDPOINT;

  /** Every company the owner endpoint knows about. */
  listCompanies(): Observable<AdminCompany[]> {
    return this.http.get<AdminCompany[]>(this.base);
  }

  /**
   * Active clients enriched with their card-pool numbers.
   *
   * "Active client" means a paying, ACTIVE subscription — NOT `is_active`, which
   * is true for every tenant (deactivating a client only expires the
   * subscription), so filtering on it would be a no-op.
   */
  loadActiveClients(): Observable<ClientRow[]> {
    return this.listCompanies().pipe(
      map((companies) => companies.filter((c) => c.subscription_type === 'ACTIVE')),
      mergeMap((active) => (active.length ? this.withCardStats(active) : of([] as ClientRow[]))),
    );
  }

  /** How many active clients there are, without pulling their pools. */
  countActive(companies: AdminCompany[]): number {
    return companies.filter((c) => c.subscription_type === 'ACTIVE').length;
  }

  /** One card-pool request per client, capped at `POOL_CONCURRENCY` in flight. */
  private withCardStats(active: AdminCompany[]): Observable<ClientRow[]> {
    return from(active).pipe(
      mergeMap(
        (c) =>
          this.http.get<QrCardStats>(`${this.base}/companies/${c.company_id}/qr-cards`).pipe(
            // One client's pool failing shouldn't lose the whole report — that
            // client just shows zeros.
            catchError(() => of({} as QrCardStats)),
            map((stats) => this.toRow(c, stats)),
          ),
        POOL_CONCURRENCY,
      ),
      toArray(),
    );
  }

  /**
   * One client by id, for the detail sheet. Two requests (the company list, then
   * that client's pool) rather than `loadActiveClients`, which fans out a
   * card-stats call per active client — a detail view needs exactly one.
   *
   * Deliberately not filtered to ACTIVE subscriptions: the report only lists
   * paying clients, but a sheet left open on a tenant who has just been parked
   * should still refresh rather than claim they don't exist. Emits null when the
   * id is unknown.
   */
  loadClient(companyId: string): Observable<ClientRow | null> {
    return this.listCompanies().pipe(
      mergeMap((companies) => {
        const company = companies.find((c) => c.company_id === companyId);
        if (!company) return of(null);
        return this.http.get<QrCardStats>(`${this.base}/companies/${companyId}/qr-cards`).pipe(
          catchError(() => of({} as QrCardStats)),
          map((stats) => this.toRow(company, stats)),
        );
      }),
    );
  }

  /** One client's cards, for printing. Defaults to the pending run. */
  listCards(companyId: string, status: CardStatus = 'unprinted'): Observable<AdminQrCard[]> {
    return this.http.get<AdminQrCard[]>(`${this.base}/companies/${companyId}/qr-cards/list`, {
      params: { status },
    });
  }

  /** Mint a run for a client: how many, which type, and the price per card. */
  generateCards(companyId: string, req: GenerateCardsRequest): Observable<{ created: number; from: number; to: number }> {
    return this.http.post<{ created: number; from: number; to: number }>(
      `${this.base}/companies/${companyId}/qr-cards`,
      { count: req.count, poolType: req.poolType, price: req.price, startFrom: req.startFrom },
    );
  }

  /**
   * Stamp a run as sent to the printer. Pass the exact ids that were downloaded —
   * omitting them marks everything unprinted, which would swallow any cards
   * minted since.
   */
  markPrinted(companyId: string, ids: string[], printed = true): Observable<{ marked: number }> {
    return this.http.post<{ marked: number }>(
      `${this.base}/companies/${companyId}/qr-cards/mark-printed`,
      { ids, printed },
    );
  }

  /**
   * Make a link for the print shop. Omitting `ids` takes everything currently
   * waiting to print; the set is pinned server-side so a later run cannot
   * enlarge a job the printer has already quoted for.
   */
  createPrintLink(companyId: string, body: { ids?: string[]; note?: string | null; expiresInDays?: number | null }):
    Observable<PrintLink & { hasAddress: boolean }> {
    return this.http.post<PrintLink & { hasAddress: boolean }>(
      `${this.base}/companies/${companyId}/print-links`, body,
    );
  }

  listPrintLinks(companyId: string): Observable<{ links: PrintLink[] }> {
    return this.http.get<{ links: PrintLink[] }>(`${this.base}/companies/${companyId}/print-links`);
  }

  /** Kill a link sent to the wrong printer. Takes effect on the next request. */
  revokePrintLink(id: string): Observable<PrintLink> {
    return this.http.post<PrintLink>(`${this.base}/print-links/${id}/revoke`, {});
  }

  /** Fresh pool numbers for one client, after minting or marking. */
  cardStats(companyId: string): Observable<QrCardStats> {
    return this.http.get<QrCardStats>(`${this.base}/companies/${companyId}/qr-cards`);
  }

  /** Every tenant's card asks — pending first, newest first within a status. */
  listCardRequests(): Observable<CardRequestRow[]> {
    return this.http.get<CardRequestRow[]>(`${this.base}/card-requests`);
  }

  /**
   * Answer one ask. Accepting records the decision — minting the run is still
   * done on the client's sheet, where serials and price are chosen.
   */
  decideCardRequest(id: string, accept: boolean): Observable<{ success: boolean; status: string }> {
    return this.http.post<{ success: boolean; status: string }>(
      `${this.base}/card-requests/${id}/decide`,
      { accept },
    );
  }

  /**
   * Set where this client's printed cards ship to. Blank clears it.
   *
   * This is the tenant's own `companies.address`, not a separate shipping field,
   * so what is typed here is what they see in their company profile.
   */
  setAddress(companyId: string, address: string | null): Observable<{ success: boolean; address: string | null }> {
    return this.http.put<{ success: boolean; address: string | null }>(
      `${this.base}/companies/${companyId}/address`,
      { address },
    );
  }

  private toRow(c: AdminCompany, stats: QrCardStats): ClientRow {
    const total = Number(stats.total ?? 0);
    const linked = Number(stats.linked ?? 0);
    return {
      id: c.company_id,
      name: c.company_name || '(unnamed)',
      type: c.company_type || '—',
      currency: c.currency ?? null,
      createdAt: c.company_created_at ?? null,
      // Trim to null so a stored blank reads as "not set", like an absent one.
      address: (c.address ?? '').trim() || null,
      mobile: c.mobile ?? null,
      ownerEmail: c.owner_email ?? null,
      subType: c.subscription_type ?? null,
      price: c.price ?? null,
      startDate: c.start_date ?? null,
      endDate: c.end_date ?? null,
      employees: Number(c.employee_count ?? 0),
      branches: Number(c.branch_count ?? 0),
      students: Number(c.student_count ?? 0),
      activeStudents: Number(c.active_student_count ?? 0),
      courses: Number(c.course_count ?? 0),
      enabled: stats.qr_cards_enabled === true,
      total,
      linked,
      // Guard against a linked count somehow exceeding the pool size.
      unlinked: Math.max(0, total - linked),
      printed: Number(stats.printed ?? 0),
      unprinted: Number(stats.unprinted ?? 0),
      poolValue: Number(stats.poolValue ?? 0),
    };
  }
}
