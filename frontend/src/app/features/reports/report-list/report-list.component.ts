import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { ReportService } from '../services/report.service';
import { BranchService } from '../../branches/services/branch.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule],
  templateUrl: './report-list.component.html',
  styleUrl: './report-list.component.scss'
})
export class ReportListComponent implements OnInit {
  private reportService = inject(ReportService);
  private branchService = inject(BranchService);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);

  branches = signal<Branch[]>([]);

  // Financial Report filters
  financialStartDate: string = '';
  financialEndDate: string = '';

  // Branch Report filters
  branchReportBranchId: string = '';
  branchStartDate: string = '';
  branchEndDate: string = '';

  ngOnInit() {
    this.loadBranches();
    this.setDefaultDates();
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => this.branches.set(branches)
    });
  }

  setDefaultDates() {
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    this.financialStartDate = firstDayOfMonth.toISOString().split('T')[0];
    this.financialEndDate = lastDayOfMonth.toISOString().split('T')[0];
    this.branchStartDate = firstDayOfMonth.toISOString().split('T')[0];
    this.branchEndDate = lastDayOfMonth.toISOString().split('T')[0];
  }

  downloadFinancialExcel() {
    if (!this.financialStartDate || !this.financialEndDate) {
      this.notificationService.error('Please select start and end dates');
      return;
    }

    const url = this.reportService.downloadFinancialReportExcel(
      this.financialStartDate,
      this.financialEndDate
    );

    this.downloadFile(url);
    this.notificationService.success('Financial report (Excel) download started');
  }

  downloadFinancialPdf() {
    if (!this.financialStartDate || !this.financialEndDate) {
      this.notificationService.error('Please select start and end dates');
      return;
    }

    const url = this.reportService.downloadFinancialReportPdf(
      this.financialStartDate,
      this.financialEndDate
    );

    this.downloadFile(url);
    this.notificationService.success('Financial report (PDF) download started');
  }

  downloadBranchExcel() {
    if (!this.branchReportBranchId) {
      this.notificationService.error('Please select a branch');
      return;
    }

    if (!this.branchStartDate || !this.branchEndDate) {
      this.notificationService.error('Please select start and end dates');
      return;
    }

    const url = this.reportService.downloadBranchReportExcel(
      this.branchReportBranchId,
      this.branchStartDate,
      this.branchEndDate
    );

    this.downloadFile(url);
    this.notificationService.success('Branch report (Excel) download started');
  }

  downloadBranchPdf() {
    if (!this.branchReportBranchId) {
      this.notificationService.error('Please select a branch');
      return;
    }

    if (!this.branchStartDate || !this.branchEndDate) {
      this.notificationService.error('Please select start and end dates');
      return;
    }

    const url = this.reportService.downloadBranchReportPdf(
      this.branchReportBranchId,
      this.branchStartDate,
      this.branchEndDate
    );

    this.downloadFile(url);
    this.notificationService.success('Branch report (PDF) download started');
  }

  downloadMonthlyFinancialExcel() {
    if (!this.financialStartDate || !this.financialEndDate) {
      this.notificationService.error('Please select start and end dates');
      return;
    }

    const url = this.reportService.downloadMonthlyFinancialReportExcel(
      this.financialStartDate,
      this.financialEndDate
    );

    this.downloadFile(url);
    this.notificationService.success('Monthly financial report (Excel) download started');
  }

  private downloadFile(url: string) {
    const token = this.authService.getToken();

    // Create a temporary link element to trigger the download
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';

    // Add authorization header via fetch for authenticated download
    fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    .then(response => response.blob())
    .then(blob => {
      const blobUrl = window.URL.createObjectURL(blob);
      link.href = blobUrl;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    })
    .catch(error => {
      console.error('Download error:', error);
      this.notificationService.error('Failed to download report');
    });
  }
}
