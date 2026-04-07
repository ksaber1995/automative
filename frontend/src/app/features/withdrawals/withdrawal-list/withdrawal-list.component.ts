import { Component } from '@angular/core';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'app-withdrawal-list',
  standalone: true,
  imports: [CardModule],
  template: `
    <div class="container mx-auto p-6 flex justify-center items-center" style="min-height: 60vh">
      <p-card styleClass="text-center" [style]="{ width: '420px' }">
        <div class="py-8 px-4">
          <i class="pi pi-clock text-5xl text-gray-300 mb-4 block"></i>
          <h2 class="text-2xl font-bold text-gray-700 mb-2">Coming Soon</h2>
          <p class="text-gray-500">The Withdrawals feature will be available soon.</p>
        </div>
      </p-card>
    </div>
  `,
})
export class WithdrawalListComponent {}

/*
// ── ORIGINAL IMPLEMENTATION (commented out — feature coming soon) ────────────

import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { FormsModule } from '@angular/forms';
import { WithdrawalService } from '../../../core/services/withdrawal.service';
import { Withdrawal } from '@shared/interfaces/withdrawal.interface';
import { NotificationService } from '../../../core/services/notification.service';

// template: full withdrawal list with date filters, summary cards, table
// methods: loadWithdrawals, loadSummary, createWithdrawal, viewWithdrawal,
//          editWithdrawal, deleteWithdrawal, canEdit, getCategorySeverity

*/
