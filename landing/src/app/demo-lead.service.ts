import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

export interface DemoLeadDto {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  country?: string;
  branchCount?: number;
  message?: string;
  source?: string;
}

export interface DemoLeadResponse {
  id: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class DemoLeadService {
  private http = inject(HttpClient);

  submit(dto: DemoLeadDto): Observable<DemoLeadResponse> {
    return this.http.post<DemoLeadResponse>(`${environment.apiUrl}/demo-leads`, dto);
  }
}
