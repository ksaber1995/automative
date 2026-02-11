import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SafeUser, LoginDto, AuthResponse, RegisterDto } from '@shared/interfaces/user.interface';

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
    const cachedUser = this.getCachedUser();

    if (token && cachedUser) {
      // Load cached user immediately for instant UI update
      this.currentUser.set(cachedUser);
      this.currentUserSubject.next(cachedUser);

      // Optionally validate token in background and refresh user data
      // If it fails, keep using cached data (offline support)
      this.getProfile().subscribe({
        next: (user) => {
          this.currentUser.set(user);
          this.currentUserSubject.next(user);
          this.setCachedUser(user);
        },
        error: () => {
          // Keep user logged in with cached data even if backend fails
          console.log('Using cached user data (backend unavailable or token expired)');
        }
      });
    } else if (token && !cachedUser) {
      // Token exists but no cached user, fetch from backend
      this.getProfile().subscribe({
        next: (user) => {
          this.currentUser.set(user);
          this.currentUserSubject.next(user);
          this.setCachedUser(user);
        },
        error: () => {
          // No cached data and backend fails, logout
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
          this.setCachedUser(response.user);
          this.currentUser.set(response.user);
          this.currentUserSubject.next(response.user);
        })
      );
  }

  register(userData: RegisterDto): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/auth/register`, userData)
      .pipe(
        tap(response => {
          this.setTokens(response.accessToken, response.refreshToken);
          this.setCachedUser(response.user);
          this.currentUser.set(response.user);
          this.currentUserSubject.next(response.user);
        })
      );
  }

  logout(): void {
    localStorage.removeItem(environment.jwtTokenKey);
    localStorage.removeItem(environment.refreshTokenKey);
    localStorage.removeItem(environment.userDataKey);
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

    // If we have both token and cached user, consider authenticated
    // This allows offline usage and persistent sessions
    if (token && cachedUser) {
      return true;
    }

    // Fallback: check token expiration if no cached user
    if (!token) return false;

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
