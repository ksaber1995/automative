import { Component } from '@angular/core';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [CardModule],
  template: `
    <div class="container mx-auto p-6 flex justify-center items-center" style="min-height: 60vh">
      <p-card styleClass="text-center" [style]="{ width: '420px' }">
        <div class="py-8 px-4">
          <i class="pi pi-clock text-5xl text-gray-300 mb-4 block"></i>
          <h2 class="text-2xl font-bold text-gray-700 mb-2">Coming Soon</h2>
          <p class="text-gray-500">The Reports feature will be available soon.</p>
        </div>
      </p-card>
    </div>
  `,
})
export class ReportListComponent {}

/*
// ── ORIGINAL IMPLEMENTATION (commented out — feature coming soon) ────────────

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

// template: templateUrl: './report-list.component.html'
// methods: loadBranches, setDefaultDates, downloadFinancialExcel, downloadFinancialPdf,
//          downloadBranchExcel, downloadBranchPdf, downloadMonthlyFinancialExcel, downloadChurnReportExcel

*/
