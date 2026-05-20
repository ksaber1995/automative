import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { SafeUser, UserCreateDto, UserUpdateDto, ConvertEmployeeToUserDto } from '@shared/interfaces/user.interface';
import { UserPermissions } from '@shared/interfaces/permissions.interface';

@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/users`;

  list(filters?: { branchId?: string; role?: string; isActive?: boolean }): Observable<{ users: SafeUser[] }> {
    let params = new HttpParams();
    if (filters?.branchId) params = params.set('branchId', filters.branchId);
    if (filters?.role) params = params.set('role', filters.role);
    if (filters?.isActive !== undefined) params = params.set('isActive', String(filters.isActive));
    return this.http.get<{ users: SafeUser[] }>(this.base, { params });
  }

  get(id: string): Observable<SafeUser> {
    return this.http.get<SafeUser>(`${this.base}/${id}`);
  }

  create(dto: UserCreateDto): Observable<SafeUser> {
    return this.http.post<SafeUser>(this.base, dto);
  }

  update(id: string, dto: UserUpdateDto): Observable<SafeUser> {
    return this.http.patch<SafeUser>(`${this.base}/${id}`, dto);
  }

  updatePermissions(id: string, permissions: UserPermissions | null): Observable<{ message: string; permissions: UserPermissions | null }> {
    return this.http.patch<{ message: string; permissions: UserPermissions | null }>(
      `${this.base}/${id}/permissions`,
      { permissions }
    );
  }

  resetPassword(id: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/${id}/reset-password`, { password });
  }

  deactivate(id: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/${id}/deactivate`, {});
  }

  activate(id: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/${id}/activate`, {});
  }

  convertEmployee(dto: ConvertEmployeeToUserDto): Observable<SafeUser> {
    return this.http.post<SafeUser>(`${this.base}/convert-employee`, dto);
  }

  delete(id: string): Observable<{ message: string; code?: string }> {
    return this.http.delete<{ message: string; code?: string }>(`${this.base}/${id}`);
  }
}
