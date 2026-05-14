import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Branch, BranchCreateDto, BranchUpdateDto } from '@shared/interfaces/branch.interface';

export interface BranchStats {
  courseCount: number;
  studentCount: number;
  classCount: number;
  employeeCount: number;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  activeEnrollments: number;
}

export interface BranchDeletionCounts {
  revenues: number;
  expenses: number;
  expensePayments: number;
  students: number;
  employees: number;
  products: number;
}

export interface BranchDeletionImpact {
  hasFinancials: boolean;
  counts: BranchDeletionCounts;
}

export interface BranchDeleteResult {
  message: string;
  deactivated: boolean;
  counts: BranchDeletionCounts;
}

export interface BranchDeleteOptions {
  studentsHandling?: 'delete' | 'deactivate';
  employeesHandling?: 'delete' | 'deactivate';
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

  getDeletionImpact(id: string): Observable<BranchDeletionImpact> {
    return this.api.get<BranchDeletionImpact>(`branches/${id}/deletion-impact`);
  }

  createBranch(branch: BranchCreateDto): Observable<Branch> {
    return this.api.post<Branch>('branches', branch);
  }

  updateBranch(id: string, branch: BranchUpdateDto): Observable<Branch> {
    return this.api.patch<Branch>(`branches/${id}`, branch);
  }

  deleteBranch(id: string, options: BranchDeleteOptions = {}): Observable<BranchDeleteResult> {
    return this.api.delete<BranchDeleteResult>(`branches/${id}`, options);
  }
}
