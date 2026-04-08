import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { DueEnrollment } from '@shared/interfaces/enrollment.interface';

@Injectable({ providedIn: 'root' })
export class DuesService {
  private api = inject(ApiService);

  getDues(branchId?: string): Observable<DueEnrollment[]> {
    const params: any = {};
    if (branchId) params['branchId'] = branchId;
    return this.api.get<DueEnrollment[]>('enrollments/dues', params);
  }
}
