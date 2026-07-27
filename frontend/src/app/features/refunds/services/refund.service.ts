import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { RefundWithDetails } from '@shared/interfaces/enrollment.interface';

export type RefundSource = 'ENROLLMENT' | 'MASTER_ENROLLMENT' | 'EVENT' | 'PRODUCT_SALE' | 'ALL';

export interface RefundFilters {
  branchId?: string;
  studentId?: string;
  type?: 'FULL' | 'PARTIAL';
  source?: RefundSource;
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
    if (filters?.source && filters.source !== 'ALL') params['source'] = filters.source;
    if (filters?.startDate) params['startDate'] = filters.startDate;
    if (filters?.endDate) params['endDate'] = filters.endDate;
    return this.api.get<RefundWithDetails[]>('refunds', params);
  }

  /** Erase a refund and undo it on the record it was taken against. */
  deleteRefund(id: string): Observable<{ message: string; code?: string }> {
    return this.api.delete<{ message: string; code?: string }>(`refunds/${id}`);
  }
}
