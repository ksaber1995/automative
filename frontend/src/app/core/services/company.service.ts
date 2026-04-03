import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type GlobalExpenseAllocation = 'PROPORTIONAL' | 'EQUAL' | 'OVERHEAD';

export interface CompanySettings {
  id: string;
  name: string;
  globalExpenseAllocation: GlobalExpenseAllocation;
}

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private api = inject(ApiService);

  getSettings(): Observable<CompanySettings> {
    return this.api.get<CompanySettings>('companies/settings');
  }

  updateSettings(settings: Partial<CompanySettings>): Observable<CompanySettings> {
    return this.api.patch<CompanySettings>('companies/settings', settings);
  }
}
