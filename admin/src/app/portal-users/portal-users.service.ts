import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ADMIN_ENDPOINT, TenantUser } from '../subscriptions.service';
import { PortalUser } from '../auth/portal-auth.service';

/** Who can sign in to this console. Separate from tenant users entirely. */
@Injectable({ providedIn: 'root' })
export class PortalUsersService {
  private http = inject(HttpClient);
  private base = `${ADMIN_ENDPOINT}/portal/users`;

  list(): Observable<{ users: PortalUser[]; allPermissions: string[] }> {
    return this.http.get<{ users: PortalUser[]; allPermissions: string[] }>(this.base);
  }

  /**
   * `debugUser` also creates the person's own debug login inside a tenant,
   * owned by the new portal user — one call, one transaction on the server.
   */
  create(body: {
    email: string; password: string; name?: string | null;
    role?: string; permissions?: string[];
    debugUser?: {
      companyId: string; email: string; password: string;
      firstName?: string; lastName?: string; role?: string;
    } | null;
  }): Observable<PortalUser & { debug_user?: TenantUser | null }> {
    return this.http.post<PortalUser & { debug_user?: TenantUser | null }>(this.base, body);
  }

  /** Everything optional — only what is sent changes. */
  update(id: string, body: {
    name?: string | null; role?: string; permissions?: string[];
    isActive?: boolean; password?: string;
  }): Observable<PortalUser> {
    return this.http.patch<PortalUser>(`${this.base}/${id}`, body);
  }

  remove(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }
}
