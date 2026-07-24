import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, from } from 'rxjs';
import { catchError, map, mergeMap, toArray } from 'rxjs/operators';
import { environment } from '../environments/environment';
import { AdminCompany, ClientRow, QrCardStats } from './models';

@Injectable({ providedIn: 'root' })
export class CardsService {
  private http = inject(HttpClient);
  private base = environment.adminEndpoint;

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

  /**
   * One card-pool request per client, capped at `poolConcurrency` in flight —
   * this fans out to one request per active client and the endpoint shouldn't be
   * hit with all of them at once.
   */
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
        environment.poolConcurrency,
      ),
      toArray(),
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
      mobile: c.mobile ?? null,
      ownerEmail: c.owner_email ?? null,
      subType: c.subscription_type ?? null,
      price: c.price ?? null,
      startDate: c.start_date ?? null,
      endDate: c.end_date ?? null,
      employees: Number(c.employee_count ?? 0),
      branches: Number(c.branch_count ?? 0),
      students: Number(c.student_count ?? 0),
      courses: Number(c.course_count ?? 0),
      enabled: stats.qr_cards_enabled === true,
      total,
      linked,
      // Guard against a linked count somehow exceeding the pool size.
      unlinked: Math.max(0, total - linked),
    };
  }
}
