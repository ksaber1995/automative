import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SafeUser, LoginDto, AuthResponse } from '@shared/interfaces/user.interface';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private currentUserSubject = new BehaviorSubject<SafeUser | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  // Signal for reactive access
  public currentUser = signal<SafeUser | null>(null);

  constructor() {
    this.loadUserFromStorage();
  }

  private loadUserFromStorage(): void {
    const token = this.getToken();
    if (token) {
      // In a real app, you'd decode the JWT to get user info
      // For now, we'll fetch the profile
      this.getProfile().subscribe({
        next: (user) => {
          this.currentUser.set(user);
          this.currentUserSubject.next(user);
        },
        error: () => {
          this.logout();
        }
      });
    }
  }

  login(credentials: LoginDto): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/auth/login`, credentials)
      .pipe(
        tap(response => {
          this.setTokens(response.accessToken, response.refreshToken);
          this.currentUser.set(response.user);
          this.currentUserSubject.next(response.user);
        })
      );
  }

  register(userData: any): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/auth/register`, userData)
      .pipe(
        tap(response => {
          this.setTokens(response.accessToken, response.refreshToken);
          this.currentUser.set(response.user);
          this.currentUserSubject.next(response.user);
        })
      );
  }

  logout(): void {
    localStorage.removeItem(environment.jwtTokenKey);
    localStorage.removeItem(environment.refreshTokenKey);
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
    if (!token) return false;

    // Check if token is expired (simple check, in production use jwt-decode)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expirationDate = payload.exp * 1000;
      return Date.now() < expirationDate;
    } catch {
      return false;
    }
  }

  hasRole(role: string): boolean {
    const user = this.currentUser();
    return user?.role === role;
  }

  hasAnyRole(roles: string[]): boolean {
    const user = this.currentUser();
    return user ? roles.includes(user.role) : false;
  }
}
