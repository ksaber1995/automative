import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { MasterClassEnrollment, MasterClassEnrollmentCreateDto } from '@shared/interfaces/master-class-enrollment.interface';

@Injectable({ providedIn: 'root' })
export class MasterClassEnrollmentService {
  private api = inject(ApiService);

  create(dto: MasterClassEnrollmentCreateDto): Observable<MasterClassEnrollment> {
    return this.api.post<MasterClassEnrollment>('master-class-enrollments', dto);
  }

  listByMasterEnrollment(masterEnrollmentId: string): Observable<MasterClassEnrollment[]> {
    return this.api.get<MasterClassEnrollment[]>('master-class-enrollments', { masterEnrollmentId });
  }

  updateStatus(id: string, status: 'ACTIVE' | 'COMPLETED' | 'DROPPED', notes?: string): Observable<MasterClassEnrollment> {
    return this.api.patch<MasterClassEnrollment>(`master-class-enrollments/${id}`, { status, notes });
  }
}
