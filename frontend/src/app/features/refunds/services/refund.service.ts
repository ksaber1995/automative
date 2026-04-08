import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { RefundWithDetails } from '@shared/interfaces/enrollment.interface';

export interface RefundFilters {
  branchId?: string;
  studentId?: string;
  type?: 'FULL' | 'PARTIAL';
  startDate?: string;
  endDate?: string;
}

@Injectable({ providedIn: 'root' })
export class RefundService {
  private api = inject(ApiService);

  getAllRefunds(filters?: RefundFilters): Observable<RefundWithDetails[]> {
    const params: any = {};
    if (filters?.branchId) params['branchId'] = filters.branchId;
    if (filters?.studentId) params['studentId'] = filters.studentId;
    if (filters?.type) params['type'] = filters.type;
    if (filters?.startDate) params['startDate'] = filters.startDate;
    if (filters?.endDate) params['endDate'] = filters.endDate;
    return this.api.get<RefundWithDetails[]>('refunds', params);
  }
}
