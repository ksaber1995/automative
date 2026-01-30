import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Branch, BranchCreateDto, BranchUpdateDto } from '@shared/interfaces/branch.interface';

export interface BranchStats {
  courseCount: number;
  studentCount: number;
  employeeCount: number;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}

@Injectable({
  providedIn: 'root'
})
export class BranchService {
  private api = inject(ApiService);

  getAllBranches(): Observable<Branch[]> {
    return this.api.get<Branch[]>('branches');
  }

  getActiveBranches(): Observable<Branch[]> {
    return this.api.get<Branch[]>('branches/active');
  }

  getBranchById(id: string): Observable<Branch> {
    return this.api.get<Branch>(`branches/${id}`);
  }

  getBranchStats(id: string): Observable<BranchStats> {
    return this.api.get<BranchStats>(`branches/${id}/stats`);
  }

  createBranch(branch: BranchCreateDto): Observable<Branch> {
    return this.api.post<Branch>('branches', branch);
  }

  updateBranch(id: string, branch: BranchUpdateDto): Observable<Branch> {
    return this.api.patch<Branch>(`branches/${id}`, branch);
  }

  deleteBranch(id: string): Observable<Branch> {
    return this.api.delete<Branch>(`branches/${id}`);
  }
}
