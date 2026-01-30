import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

@Injectable({
  providedIn: 'root'
})
export class ReportService {
  private api = inject(ApiService);

  downloadFinancialReportExcel(startDate: string, endDate: string): string {
    const params = new URLSearchParams({ startDate, endDate });
    return this.api.getBaseUrl() + `/reports/excel/financial?${params.toString()}`;
  }

  downloadFinancialReportPdf(startDate: string, endDate: string): string {
    const params = new URLSearchParams({ startDate, endDate });
    return this.api.getBaseUrl() + `/reports/pdf/financial?${params.toString()}`;
  }

  downloadBranchReportExcel(branchId: string, startDate: string, endDate: string): string {
    const params = new URLSearchParams({ startDate, endDate });
    return this.api.getBaseUrl() + `/reports/excel/branch/${branchId}?${params.toString()}`;
  }

  downloadBranchReportPdf(branchId: string, startDate: string, endDate: string): string {
    const params = new URLSearchParams({ startDate, endDate });
    return this.api.getBaseUrl() + `/reports/pdf/branch/${branchId}?${params.toString()}`;
  }
}
