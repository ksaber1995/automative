import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ADMIN_ENDPOINT } from '../subscriptions.service';

/** A sign-in to this console. Never carries a password. */
export interface PortalUser {
  id: string;
  email: string;
  name: string | null;
  /** OWNER holds every permission implicitly; MEMBER holds exactly `permissions`. */
  role: 'OWNER' | 'MEMBER' | string;
  permissions: string[];
  is_active: boolean;
  last_login_at: string | null;
  created_at: string | null;
}

/**
 * The console's session.
 *
 * The `karim-admin-secret` endpoints used to be open to anyone who knew the URL.
 * They now want a bearer token, which is what this holds. The token is kept in
 * localStorage so a reload doesn't sign you out — acceptable for a tool that
 * only ever runs on the owner's own machine, and the reason the token is short
 * lived (12h) at the other end.
 */
@Injectable({ providedIn: 'root' })
export class PortalAuthService {
  private http = inject(HttpClient);
  private static readonly TOKEN_KEY = 'netrofit.admin.token';

  readonly token = signal<string | null>(localStorage.getItem(PortalAuthService.TOKEN_KEY));
  readonly user = signal<PortalUser | null>(null);
  /** Every permission key the API knows about — the source for the editor's checkboxes. */
  readonly allPermissions = signal<string[]>([]);

  /**
   * The startup probe has finished. Until it has, the shell must show neither
   * the console nor the login page: a stored token that turns out to be valid
   * would otherwise flash the login form on every reload.
   */
  readonly ready = signal(false);

  readonly signedIn = computed(() => !!this.user());

  /** Re-validate a stored token, or settle straight to "signed out". */
  restore(): void {
    if (!this.token()) {
      this.ready.set(true);
      return;
    }
    this.http.get<{ user: PortalUser; allPermissions: string[] }>(`${ADMIN_ENDPOINT}/portal/me`).subscribe({
      next: (res) => {
        this.user.set(res.user);
        this.allPermissions.set(res.allPermissions);
        this.ready.set(true);
      },
      // Expired, revoked or disabled — all the same to the shell.
      error: () => {
        this.clear();
        this.ready.set(true);
      },
    });
  }

  login(email: string, password: string): Observable<{ token: string; user: PortalUser; allPermissions: string[] }> {
    return this.http
      .post<{ token: string; user: PortalUser; allPermissions: string[] }>(`${ADMIN_ENDPOINT}/portal/login`, { email, password })
      .pipe(
        tap((res) => {
          localStorage.setItem(PortalAuthService.TOKEN_KEY, res.token);
          this.token.set(res.token);
          this.user.set(res.user);
          this.allPermissions.set(res.allPermissions);
          this.ready.set(true);
        }),
      );
  }

  changeOwnPassword(currentPassword: string, newPassword: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${ADMIN_ENDPOINT}/portal/password`, { currentPassword, newPassword });
  }

  logout(): void {
    this.clear();
    this.ready.set(true);
  }

  /** Forget the session without deciding what the shell should show next. */
  clear(): void {
    localStorage.removeItem(PortalAuthService.TOKEN_KEY);
    this.token.set(null);
    this.user.set(null);
  }

  /**
   * Does the signed-in user hold this permission (or any of several)?
   *
   * Mirrors the server's rule exactly — OWNER short-circuits to true, everyone
   * else needs one of the keys. This only hides controls; the API checks the
   * same thing again on every call, so a hidden button is a courtesy and not
   * the security boundary.
   */
  can(needed: string | string[]): boolean {
    const u = this.user();
    if (!u) return false;
    if (u.role === 'OWNER') return true;
    const wanted = Array.isArray(needed) ? needed : [needed];
    return wanted.some((p) => u.permissions.includes(p));
  }
}
