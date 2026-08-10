import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SafeUser, LoginDto, AuthResponse, RegisterDto, RegisterResponse, CompanyVertical } from '@shared/interfaces/user.interface';
import { VocabularyService } from './vocabulary.service';
import { UserRole } from '@shared/enums/user-role.enum';
import {
  PermissionResource,
  PermissionAction,
  ROLE_DEFAULT_PERMISSIONS,
} from '@shared/interfaces/permissions.interface';
import { LANGUAGE_STORAGE_KEY } from './language.service';

/**
 * Tenants trialling WhatsApp Cloud API messaging, by company id:
 * `netrofit` (teacher) and `Karim` (academy). See `canUseWhatsapp`.
 */
const WHATSAPP_TRIAL_COMPANIES = [
  'b6420df6-74fc-4d9d-ab56-78106b376f06',
  '07d91513-9a21-478c-ba46-4a8d6aa84150',
];

/**
 * The vendor's own two tenants — `netrofit` (teacher) and `Karim` (academy) — the
 * ones used to test in prod. Vendor tools show here as well as on the debug login.
 * Same two ids as the WhatsApp trial above today; kept separate because that list
 * grows with trialling customers, and this one must not.
 */
const VENDOR_TEST_COMPANIES = [
  'b6420df6-74fc-4d9d-ab56-78106b376f06',
  '07d91513-9a21-478c-ba46-4a8d6aa84150',
];

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private vocabulary = inject(VocabularyService);

  private currentUserSubject = new BehaviorSubject<SafeUser | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();
  public currentUser = signal<SafeUser | null>(null);

  constructor() {
    this.loadUserFromStorage();
  }

  /**
   * The one place the signed-in user is published.
   *
   * Every entry point — restoring from storage, login, OTP verify, refresh —
   * goes through here, so a tenant's vocabulary is loaded WITH the user instead
   * of only on whichever path someone remembered to wire it into. Getting that
   * wrong shows a sports academy the word "student" until the next full reload.
   */
  private publishUser(user: SafeUser, cache = true): void {
    this.currentUser.set(user);
    this.currentUserSubject.next(user);
    if (cache) this.setCachedUser(user);
    void this.vocabulary.use(user.vertical === 'SPORTS' ? 'SPORTS' : 'GENERAL');
  }

  private loadUserFromStorage(): void {
    const token = this.getToken();
    const cachedUser = this.getCachedUser();

    if (token && cachedUser) {
      // Straight from the cache first so the app paints in the right vocabulary
      // immediately, then corrected by the profile call.
      this.publishUser(cachedUser, false);

      this.getProfile().subscribe({
        next: (user) => this.publishUser(user),
        error: (err) => {
          if (err?.status === 401) this.logout();
        }
      });
    } else if (token && !cachedUser) {
      this.getProfile().subscribe({
        next: (user) => this.publishUser(user),
        error: () => this.logout()
      });
    }
  }

  login(credentials: LoginDto): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/auth/login`, credentials)
      .pipe(
        tap(response => {
          // Establishing a session is also a tenant switch when the previous one
          // was never formally logged out (expired token, a second tab). Start
          // clean so nothing of the last account survives into this one.
          this.clearStoredData();
          this.setTokens(response.accessToken, response.refreshToken);
          this.publishUser(response.user);
          if (response.company?.name) {
            localStorage.setItem('company_name', response.company.name);
          }
        })
      );
  }

  register(userData: RegisterDto): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${environment.apiUrl}/auth/register`, userData);
  }

  verifyEmail(email: string, otp: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/auth/verify-email`, { email, otp })
      .pipe(
        tap(response => {
          // Establishing a session is also a tenant switch when the previous one
          // was never formally logged out (expired token, a second tab). Start
          // clean so nothing of the last account survives into this one.
          this.clearStoredData();
          this.setTokens(response.accessToken, response.refreshToken);
          this.publishUser(response.user);
          if (response.company?.name) {
            localStorage.setItem('company_name', response.company.name);
          }
        })
      );
  }

  resendEmailOtp(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/auth/resend-email-otp`, { email });
  }

  forgotPassword(phone: string, recaptchaToken?: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/auth/forgot-password`, { phone, recaptchaToken });
  }

  resetPassword(phone: string, otp: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/auth/reset-password`, { phone, otp, password });
  }

  logout(): void {
    this.clearStoredData();
    this.currentUser.set(null);
    this.currentUserSubject.next(null);
    // The next tenant may speak differently; don't leave this one's words behind.
    // (The reload below would clear them anyway — this keeps the service honest
    // for any path that logs out without one.)
    this.vocabulary.reset();
    // A full document load, not router.navigate: clearing storage does nothing
    // about root-provided singletons, which keep their caches across an in-app
    // navigation. BranchStateService is the one that bit us — it caches the
    // company's branches behind a `loaded` guard and never refetches, so signing
    // in as another tenant left the previous tenant's branches in memory and the
    // room form wrote one of THEIR branch ids onto a new room.
    //
    // Same reasoning as the blanket storage clear above: enumerating the caches
    // to reset is a list that goes stale the moment someone adds a service.
    // Reloading the document drops all of them at once.
    window.location.href = '/auth/login';
  }

  /**
   * Leave nothing of the session on the device. A blanket clear, not a list of
   * keys: feature code stashes its own state (saved filters, cached company
   * name, scanner detection…), and a hand-maintained list goes stale the moment
   * someone adds a key — which is how one user's data ends up in front of the
   * next one on a shared machine.
   *
   * The UI language is the deliberate exception. It's a device preference set
   * before anyone signs in, so wiping it would throw the login page back to the
   * default on every logout.
   */
  private clearStoredData(): void {
    const lang = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    localStorage.clear();
    sessionStorage.clear();
    if (lang) localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }

  getProfile(): Observable<SafeUser> {
    return this.http.get<SafeUser>(`${environment.apiUrl}/auth/profile`);
  }

  /** Re-fetch the signed-in user so plan/permission-driven UI (e.g. CRM nav) updates in place. */
  refreshUser(): void {
    this.getProfile().subscribe({
      next: (user) => this.publishUser(user),
      error: () => {},
    });
  }

  getToken(): string | null {
    return localStorage.getItem(environment.jwtTokenKey);
  }

  /** The signed-in user's company/academy display name (cached at login). */
  getCompanyName(): string {
    return localStorage.getItem('company_name') || '';
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(environment.refreshTokenKey);
  }

  private setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(environment.jwtTokenKey, accessToken);
    localStorage.setItem(environment.refreshTokenKey, refreshToken);
  }

  isAuthenticated(): boolean {
    const token = this.getToken();
    const cachedUser = this.getCachedUser();
    if (token && cachedUser) return true;
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return Date.now() < payload.exp * 1000;
    } catch {
      return false;
    }
  }

  // ─── Role checks ────────────────────────────────────────────────────────────

  hasRole(role: string): boolean {
    return this.currentUser()?.role === role;
  }

  hasAnyRole(roles: string[]): boolean {
    const user = this.currentUser();
    return user ? roles.includes(user.role) : false;
  }

  isGlobalAdmin(): boolean {
    return this.hasAnyRole([UserRole.GLOBAL_ADMIN, UserRole.ADMIN]);
  }

  isBranchAdmin(): boolean {
    return this.hasAnyRole([UserRole.BRANCH_ADMIN, UserRole.BRANCH_MANAGER]);
  }

  canManageUsers(): boolean {
    return this.isGlobalAdmin();
  }

  /**
   * True when the signed-in user's company registered as an individual TEACHER
   * (rather than an ACADEMY). Used to hide academy-only features such as
   * master courses/classes.
   */
  isTeacher(): boolean {
    return this.currentUser()?.companyType === 'TEACHER';
  }

  /** Company feature plan; ADVANCED unlocks CRM and future add-ons. */
  plan(): 'SIMPLE' | 'ADVANCED' {
    return this.currentUser()?.plan === 'ADVANCED' ? 'ADVANCED' : 'SIMPLE';
  }

  /**
   * What this academy calls things. Never gate a FEATURE on this — a sports
   * academy is an advanced academy and must pass every plan check unchanged.
   * It exists so the vocabulary overlay knows which words to load.
   */
  vertical(): CompanyVertical {
    return this.currentUser()?.vertical === 'SPORTS' ? 'SPORTS' : 'GENERAL';
  }

  /** CRM is available to academies (not solo teachers) on the Advanced plan. */
  /**
   * The pre-printed QR card pool. Sold per academy and off by default, so the page
   * and the student's Link-card button stay hidden until we enable it for them.
   * The API enforces it too — this only decides what is worth showing.
   */
  canUseQrCards(): boolean {
    return this.currentUser()?.qrCardsEnabled === true;
  }

  /**
   * The vendor's debugging login (master@master.com), parked inside a tenant to
   * reproduce what a customer sees. Some tools are for the vendor only and stay
   * hidden from every real user; this decides who they are worth showing to.
   *
   * The backend owns the canonical copy (aws/.../utils/debug-account.ts, and the
   * admin app keeps its own) — the frontend can't import across those builds, so
   * the address is repeated here. Cosmetic only: it hides UI, it does not gate any
   * route or endpoint.
   */
  isDebugUser(): boolean {
    return (this.currentUser()?.email ?? '').trim().toLowerCase() === 'master@master.com';
  }

  /**
   * Who sees the pre-printed QR card pool (the page and its sidebar entry): the
   * debug login, plus every user in the vendor's own test tenants, so the pool can
   * be worked with while logged in as those. Still hidden from real customers.
   */
  canSeeQrCardPool(): boolean {
    const companyId = this.currentUser()?.companyId;
    return this.isDebugUser() || (!!companyId && VENDOR_TEST_COMPANIES.includes(companyId));
  }

  canUseCrm(): boolean {
    return !this.isTeacher() && this.plan() === 'ADVANCED';
  }

  /**
   * An academy that registered on Basic. Events and Reports are part of what
   * Advanced buys, so they stay hidden for these tenants.
   *
   * Expenses used to be on that list and no longer is: rent, bills and equipment
   * are what running an academy costs rather than something to upsell, and the
   * API never gated them anyway — so a Basic academy had a working page and no
   * way to reach it.
   *
   * Deliberately narrower than canUseCrm/canUseCash: a solo TEACHER keeps these
   * whatever their plan. The restriction is about what an academy's Basic tier
   * includes, not about the feature being unavailable to small tenants.
   */
  isBasicAcademy(): boolean {
    return !this.isTeacher() && this.plan() === 'SIMPLE';
  }

  /**
   * The cash drawer (Current Cash page, its dashboard tile and its permission rows).
   * Advanced-plan academies only: teachers have no drawer, and an academy that
   * registered on Basic does not get the feature at all — not a locked page with an
   * upgrade prompt. The API refuses the endpoints on the same rule.
   */
  canUseCash(): boolean {
    return !this.isTeacher() && this.plan() === 'ADVANCED';
  }

  /**
   * WhatsApp (Cloud API) messaging, limited to the tenants trialling it while the
   * Meta onboarding — business verification, display name, template approval — is
   * still being worked through per company. Everyone else would land on a Connect
   * page they cannot finish.
   *
   * The allowlist is by company, so any user in these tenants sees it, and it is
   * hardcoded on purpose: this is a temporary trial gate, not a sellable feature.
   * When WhatsApp ships to customers, replace this with a server-driven per-tenant
   * flag on SafeUser (see `canUseQrCards`) rather than growing the list.
   *
   * Cosmetic only — it decides what is worth showing. The /whatsapp routes stay
   * reachable by URL and the API does not gate these endpoints.
   */
  canUseWhatsapp(): boolean {
    const companyId = this.currentUser()?.companyId;
    return !!companyId && WHATSAPP_TRIAL_COMPANIES.includes(companyId);
  }

  /**
   * True when the teacher tenant falls in the free QR-activation launch tier
   * (first 100 registered teacher companies). Drives the QR dialog to activate
   * for free instead of prompting for the paid plans.
   */
  isQrFree(): boolean {
    return this.currentUser()?.qrFree === true;
  }

  // ─── Permission checks ───────────────────────────────────────────────────────

  /**
   * Check if current user has the given permission on a resource.
   * Custom permissions override role defaults.
   */
  hasPermission(resource: PermissionResource, action: PermissionAction): boolean {
    const user = this.currentUser();
    if (!user) return false;

    // Custom override takes precedence
    const custom = user.permissions?.[resource]?.[action];
    if (custom !== undefined) return custom as boolean;

    // Fall back to role defaults
    const role = user.role as UserRole;
    return ROLE_DEFAULT_PERMISSIONS[role]?.[resource]?.[action] ?? false;
  }

  canRead(resource: PermissionResource): boolean {
    return this.hasPermission(resource, 'read');
  }

  canWrite(resource: PermissionResource): boolean {
    return this.hasPermission(resource, 'write');
  }

  canDelete(resource: PermissionResource): boolean {
    return this.hasPermission(resource, 'delete');
  }

  canAccessFinancials(): boolean {
    return (
      this.hasPermission('revenues', 'read') ||
      this.hasPermission('expenses', 'read') ||
      this.hasPermission('reports', 'read')
    );
  }

  canAccessAcademics(): boolean {
    return (
      this.hasPermission('students', 'read') ||
      this.hasPermission('academy', 'read')
    );
  }

  // ─── Storage helpers ─────────────────────────────────────────────────────────

  private setCachedUser(user: SafeUser): void {
    localStorage.setItem(environment.userDataKey, JSON.stringify(user));
  }

  private getCachedUser(): SafeUser | null {
    try {
      const userData = localStorage.getItem(environment.userDataKey);
      return userData ? JSON.parse(userData) : null;
    } catch {
      return null;
    }
  }
}
