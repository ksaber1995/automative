import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

/**
 * Relative on purpose, in dev AND prod: CloudFront proxies /api/* to the API
 * same-origin in production (the apiProxy behaviour on NetrofitExamsStack-prod),
 * and `ng serve` does the same through proxy.conf.json — so the execute-api
 * hostname never ships in the bundle and the API's CORS allowlist never needs
 * an entry for this app.
 */
const API = '/api/student-auth';

const TOKEN_KEY = 'netrofit.exams.token';

export interface StudentInfo {
  name: string;
  username: string;
}

export interface StudentMe extends StudentInfo {
  companyName: string;
  branchName: string | null;
  lastLoginAt: string | null;
}

export interface ClaimStartResult {
  studentName: string;
  hasCredentials: boolean;
  claimTicket: string;
}

interface SessionResponse {
  token: string;
  student: StudentInfo;
}

/**
 * The portal's session, and nothing else: a token in localStorage, the signed-in
 * student's name, and the in-flight claim between /scan and /claim. None of the
 * staff app's AuthService, permissions or branch machinery exists here — a
 * student session grants exactly the student endpoints, for one student.
 */
@Injectable({ providedIn: 'root' })
export class StudentAuthService {
  private http = inject(HttpClient);

  token = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  student = signal<StudentInfo | null>(null);
  /** False until restore() has decided whether the stored token still works. */
  ready = signal(false);
  signedIn = computed(() => this.token() !== null);

  /**
   * The successful scan being carried from /scan to /claim. Held in memory
   * only — a reload mid-claim just means scanning again, which is cheaper than
   * a ticket sitting in storage.
   */
  claim = signal<ClaimStartResult | null>(null);

  /** Re-validate the stored token against /me on every app load. */
  restore(): void {
    if (!this.token()) {
      this.ready.set(true);
      return;
    }
    this.me().subscribe({
      next: (me) => {
        this.student.set({ name: me.name, username: me.username });
        this.ready.set(true);
      },
      error: () => {
        this.clear();
        this.ready.set(true);
      },
    });
  }

  claimStart(qrToken: string): Observable<ClaimStartResult> {
    return this.http
      .post<ClaimStartResult>(`${API}/claim-start`, { qrToken })
      .pipe(tap((r) => this.claim.set(r)));
  }

  claimFinish(username: string, password: string): Observable<SessionResponse> {
    const claimTicket = this.claim()?.claimTicket ?? '';
    return this.http
      .post<SessionResponse>(`${API}/claim-finish`, { claimTicket, username, password })
      .pipe(tap((r) => this.setSession(r)));
  }

  login(identifier: string, password: string): Observable<SessionResponse> {
    return this.http
      .post<SessionResponse>(`${API}/login`, { identifier, password })
      .pipe(tap((r) => this.setSession(r)));
  }

  me(): Observable<StudentMe> {
    return this.http.get<StudentMe>(`${API}/me`);
  }

  logout(): void {
    this.clear();
  }

  /** Wipe the session locally. Called by the interceptor on any 401. */
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.token.set(null);
    this.student.set(null);
  }

  private setSession(r: SessionResponse): void {
    localStorage.setItem(TOKEN_KEY, r.token);
    this.token.set(r.token);
    this.student.set(r.student);
    this.claim.set(null);
  }
}
