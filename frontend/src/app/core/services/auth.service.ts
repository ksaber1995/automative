import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SafeUser, LoginDto, AuthResponse, RegisterDto, RegisterResponse } from '@shared/interfaces/user.interface';
import { UserRole } from '@shared/enums/user-role.enum';
import {
  PermissionResource,
  PermissionAction,
  ROLE_DEFAULT_PERMISSIONS,
} from '@shared/interfaces/permissions.interface';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private currentUserSubject = new BehaviorSubject<SafeUser | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();
  public currentUser = signal<SafeUser | null>(null);

  constructor() {
    this.loadUserFromStorage();
  }

  private loadUserFromStorage(): void {
    const token = this.getToken();
    const cachedUser = this.getCachedUser();

    if (token && cachedUser) {
      this.currentUser.set(cachedUser);
      this.currentUserSubject.next(cachedUser);

      this.getProfile().subscribe({
        next: (user) => {
          this.currentUser.set(user);
          this.currentUserSubject.next(user);
          this.setCachedUser(user);
        },
        error: (err) => {
          if (err?.status === 401) this.logout();
        }
      });
    } else if (token && !cachedUser) {
      this.getProfile().subscribe({
        next: (user) => {
          this.currentUser.set(user);
          this.currentUserSubject.next(user);
          this.setCachedUser(user);
        },
        error: () => this.logout()
      });
    }
  }

  login(credentials: LoginDto): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/auth/login`, credentials)
      .pipe(
        tap(response => {
          this.setTokens(response.accessToken, response.refreshToken);
          this.setCachedUser(response.user);
          this.currentUser.set(response.user);
          this.currentUserSubject.next(response.user);
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
          this.setTokens(response.accessToken, response.refreshToken);
          this.setCachedUser(response.user);
          this.currentUser.set(response.user);
          this.currentUserSubject.next(response.user);
          if (response.company?.name) {
            localStorage.setItem('company_name', response.company.name);
          }
        })
      );
  }

  resendEmailOtp(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/auth/resend-email-otp`, { email });
  }

  forgotPassword(email: string, recaptchaToken?: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/auth/forgot-password`, { email, recaptchaToken });
  }

  resetPassword(token: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/auth/reset-password`, { token, password });
  }

  logout(): void {
    localStorage.removeItem(environment.jwtTokenKey);
    localStorage.removeItem(environment.refreshTokenKey);
    localStorage.removeItem(environment.userDataKey);
    localStorage.removeItem('company_name');
    this.currentUser.set(null);
    this.currentUserSubject.next(null);
    this.router.navigate(['/auth/login']);
  }

  getProfile(): Observable<SafeUser> {
    return this.http.get<SafeUser>(`${environment.apiUrl}/auth/profile`);
  }

  getToken(): string | null {
    return localStorage.getItem(environment.jwtTokenKey);
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
