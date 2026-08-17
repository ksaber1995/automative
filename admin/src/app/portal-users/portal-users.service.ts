import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ADMIN_ENDPOINT } from '../subscriptions.service';
import { PortalUser } from '../auth/portal-auth.service';

/** Who can sign in to this console. Separate from tenant users entirely. */
@Injectable({ providedIn: 'root' })
export class PortalUsersService {
  private http = inject(HttpClient);
  private base = `${ADMIN_ENDPOINT}/portal/users`;

  list(): Observable<{ users: PortalUser[]; allPermissions: string[] }> {
    return this.http.get<{ users: PortalUser[]; allPermissions: string[] }>(this.base);
  }

  create(body: {
    email: string; password: string; name?: string | null;
    role?: string; permissions?: string[];
  }): Observable<PortalUser> {
    return this.http.post<PortalUser>(this.base, body);
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
