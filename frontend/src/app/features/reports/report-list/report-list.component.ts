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

    this.reportService.downloadFinancialReportExcel(
      this.financialStartDate,
      this.financialEndDate
    ).subscribe({
      next: (response) => {
        this.reportService.downloadBase64File(response.data, response.filename);
        this.notificationService.success('Financial report downloaded successfully');
      },
      error: (error) => {
        console.error('Download error:', error);
        this.notificationService.error('Failed to download financial report');
      }
    });
  }

  downloadFinancialPdf() {
    this.notificationService.error('PDF reports are not yet implemented');
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

    this.reportService.downloadBranchReportExcel(
      this.branchReportBranchId,
      this.branchStartDate,
      this.branchEndDate
    ).subscribe({
      next: (response) => {
        this.reportService.downloadBase64File(response.data, response.filename);
        this.notificationService.success('Branch report downloaded successfully');
      },
      error: (error) => {
        console.error('Download error:', error);
        this.notificationService.error('Failed to download branch report');
      }
    });
  }

  downloadBranchPdf() {
    this.notificationService.error('PDF reports are not yet implemented');
  }

  downloadMonthlyFinancialExcel() {
    if (!this.financialStartDate || !this.financialEndDate) {
      this.notificationService.error('Please select start and end dates');
      return;
    }

    this.reportService.downloadMonthlyFinancialReportExcel(
      this.financialStartDate,
      this.financialEndDate
    ).subscribe({
      next: (response) => {
        this.reportService.downloadBase64File(response.data, response.filename);
        this.notificationService.success('Monthly financial report downloaded successfully');
      },
      error: (error) => {
        console.error('Download error:', error);
        this.notificationService.error('Failed to download monthly financial report');
      }
    });
  }

  downloadChurnReportExcel() {
    if (!this.financialStartDate || !this.financialEndDate) {
      this.notificationService.error('Please select start and end dates');
      return;
    }

    this.reportService.downloadChurnReportExcel(
      this.financialStartDate,
      this.financialEndDate
    ).subscribe({
      next: (response) => {
        this.reportService.downloadBase64File(response.data, response.filename);
        this.notificationService.success('Churn rate report downloaded successfully');
      },
      error: (error) => {
        console.error('Download error:', error);
        this.notificationService.error('Failed to download churn report');
      }
    });
  }
}
