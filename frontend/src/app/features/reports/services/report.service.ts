import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';

interface ReportResponse {
  data: string; // base64 encoded file
  filename: string;
}

@Injectable({
  providedIn: 'root'
})
export class ReportService {
  private api = inject(ApiService);

  downloadFinancialReportExcel(startDate: string, endDate: string): Observable<ReportResponse> {
    return this.api.get<ReportResponse>(`reports/excel/financial`, { startDate, endDate });
  }

  downloadBranchReportExcel(branchId: string, startDate: string, endDate: string): Observable<ReportResponse> {
    return this.api.get<ReportResponse>(`reports/excel/branch/${branchId}`, { startDate, endDate });
  }

  downloadMonthlyFinancialReportExcel(startDate: string, endDate: string): Observable<ReportResponse> {
    return this.api.get<ReportResponse>(`reports/excel/financial-monthly`, { startDate, endDate });
  }

  downloadChurnReportExcel(startDate: string, endDate: string): Observable<ReportResponse> {
    return this.api.get<ReportResponse>(`reports/excel/churn`, { startDate, endDate });
  }

  // Helper method to download base64 file
  downloadBase64File(base64Data: string, filename: string) {
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(link.href);
  }
}
