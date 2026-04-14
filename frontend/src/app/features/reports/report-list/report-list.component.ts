import { Component } from '@angular/core';
import { CardModule } from 'primeng/card';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [CardModule, TranslateModule],
  templateUrl: './report-list.component.html',
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
