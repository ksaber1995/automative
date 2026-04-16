import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { TranslateModule } from '@ngx-translate/core';
import { EventService } from '../services/event.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { EventModel, EventPL } from '@shared/interfaces/event.interface';

@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ButtonModule,
    TagModule,
    DividerModule,
    TranslateModule,
  ],
  template: `
    <div class="container-custom py-8">
      <div class="mb-6 flex justify-between items-start">
        <div>
          <p-button
            icon="pi pi-arrow-left"
            [text]="true"
            [label]="'EVENTS.DETAIL.BACK' | translate"
            (onClick)="back()"
          ></p-button>
          <h1 class="text-3xl font-bold text-gray-900 mt-2">{{ event()?.name }}</h1>
          <div class="flex gap-2 mt-2">
            @if (event(); as e) {
              <p-tag [value]="('EVENTS.TYPE.' + e.eventType) | translate" severity="info"></p-tag>
              <p-tag [value]="('EVENTS.STATUS.' + e.status) | translate" [severity]="statusSeverity(e.status)"></p-tag>
            }
          </div>
        </div>
        @if (event() && authService.canWrite('events')) {
          <p-button
            icon="pi pi-pencil"
            [label]="'EVENTS.DETAIL.EDIT' | translate"
            severity="secondary"
            [outlined]="true"
            (onClick)="edit()"
          ></p-button>
        }
      </div>

      @if (event(); as e) {
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <p-card>
            <div class="text-sm text-gray-500">{{ 'EVENTS.DETAIL.LOCATION' | translate }}</div>
            <div class="text-lg font-semibold">{{ e.location || '—' }}</div>
          </p-card>
          <p-card>
            <div class="text-sm text-gray-500">{{ 'EVENTS.DETAIL.DATES' | translate }}</div>
            <div class="text-lg font-semibold">
              {{ (e.startDate | date: 'mediumDate') || '—' }}
              @if (e.endDate && e.endDate !== e.startDate) {
                → {{ e.endDate | date: 'mediumDate' }}
              }
            </div>
          </p-card>
          <p-card>
            <div class="text-sm text-gray-500">{{ 'EVENTS.DETAIL.BUDGET' | translate }}</div>
            <div class="text-lg font-semibold">
              {{ e.budget !== null ? e.budget.toFixed(2) : '—' }}
            </div>
          </p-card>
        </div>

        @if (e.description) {
          <p-card styleClass="mb-6">
            <div class="text-sm text-gray-500 mb-2">{{ 'EVENTS.DETAIL.DESCRIPTION' | translate }}</div>
            <div class="text-gray-800 whitespace-pre-line">{{ e.description }}</div>
          </p-card>
        }
      }

      <p-card>
        <ng-template pTemplate="header">
          <div class="px-6 py-4 border-b">
            <h3 class="text-xl font-semibold">{{ 'EVENTS.DETAIL.PL_TITLE' | translate }}</h3>
            <p class="text-sm text-gray-500 mt-1">{{ 'EVENTS.DETAIL.PL_DESC' | translate }}</p>
          </div>
        </ng-template>

        @if (pl(); as p) {
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-green-50 p-4 rounded">
              <div class="text-sm text-green-700 font-medium mb-1">
                {{ 'EVENTS.DETAIL.REVENUE' | translate }}
                <span class="text-gray-500 ml-2">({{ p.revenueCount }})</span>
              </div>
              <div class="text-2xl font-bold text-green-700">{{ p.revenue.toFixed(2) }}</div>
            </div>

            <div class="bg-red-50 p-4 rounded">
              <div class="text-sm text-red-700 font-medium mb-1">
                {{ 'EVENTS.DETAIL.EXPENSES' | translate }}
                <span class="text-gray-500 ml-2">({{ p.expenseCount }})</span>
              </div>
              <div class="text-2xl font-bold text-red-700">{{ p.expenses.toFixed(2) }}</div>
            </div>

            <div class="bg-orange-50 p-4 rounded">
              <div class="text-sm text-orange-700 font-medium mb-1">
                {{ 'EVENTS.DETAIL.REFUNDS' | translate }}
                <span class="text-gray-500 ml-2">({{ p.refundCount }})</span>
              </div>
              <div class="text-2xl font-bold text-orange-700">{{ p.refunds.toFixed(2) }}</div>
            </div>

            <div class="bg-blue-50 p-4 rounded">
              <div class="text-sm text-blue-700 font-medium mb-1">
                {{ 'EVENTS.DETAIL.PRODUCT_MARGIN' | translate }}
                <span class="text-gray-500 ml-2">({{ p.productSaleCount }})</span>
              </div>
              <div class="text-2xl font-bold text-blue-700">{{ p.productMargin.toFixed(2) }}</div>
              <div class="text-xs text-gray-500 mt-1">
                {{ 'EVENTS.DETAIL.PRODUCT_REVENUE' | translate }}: {{ p.productRevenue.toFixed(2) }}
                · {{ 'EVENTS.DETAIL.PRODUCT_COST' | translate }}: {{ p.productCost.toFixed(2) }}
              </div>
            </div>
          </div>

          <p-divider></p-divider>

          <div
            class="flex justify-between items-center p-4 rounded"
            [ngClass]="p.netProfit >= 0 ? 'bg-green-100' : 'bg-red-100'"
          >
            <div>
              <div class="text-sm font-medium">{{ 'EVENTS.DETAIL.NET_PROFIT' | translate }}</div>
              <div class="text-xs text-gray-600 mt-1">
                {{ 'EVENTS.DETAIL.NET_FORMULA' | translate }}
              </div>
            </div>
            <div
              class="text-3xl font-bold"
              [ngClass]="p.netProfit >= 0 ? 'text-green-700' : 'text-red-700'"
            >
              {{ p.netProfit.toFixed(2) }}
            </div>
          </div>

          @if (p.budget !== null) {
            <div class="mt-4 p-4 bg-gray-50 rounded flex justify-between items-center">
              <div class="text-sm">
                <span class="font-medium">{{ 'EVENTS.DETAIL.BUDGET_VS_ACTUAL' | translate }}:</span>
                {{ 'EVENTS.DETAIL.BUDGET' | translate }} {{ p.budget.toFixed(2) }}
                · {{ 'EVENTS.DETAIL.SPENT' | translate }} {{ (p.expenses + p.refunds + p.productCost).toFixed(2) }}
              </div>
              <p-tag
                [value]="budgetStatus(p)"
                [severity]="(p.expenses + p.refunds + p.productCost) > p.budget ? 'danger' : 'success'"
              ></p-tag>
            </div>
          }
        } @else {
          <div class="text-center py-8 text-gray-500">
            <i class="pi pi-spin pi-spinner text-2xl"></i>
          </div>
        }
      </p-card>
    </div>
  `,
})
export class EventDetailComponent implements OnInit {
  private service = inject(EventService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  authService = inject(AuthService);

  id!: string;
  event = signal<EventModel | null>(null);
  pl = signal<EventPL | null>(null);

  ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id')!;
    this.service.getById(this.id).subscribe({
      next: (e) => this.event.set(e),
      error: () => {
        this.notifications.error('Failed to load event');
        this.router.navigate(['/events']);
      },
    });
    this.service.getPL(this.id).subscribe({
      next: (p) => this.pl.set(p),
    });
  }

  edit() { this.router.navigate(['/events', this.id, 'edit']); }
  back() { this.router.navigate(['/events']); }

  statusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'ACTIVE': return 'success';
      case 'PLANNED': return 'info';
      case 'COMPLETED': return 'secondary';
      case 'CANCELLED': return 'danger';
      default: return 'info';
    }
  }

  budgetStatus(p: EventPL): string {
    const spent = p.expenses + p.refunds + p.productCost;
    return spent > (p.budget || 0) ? 'Over Budget' : 'Under Budget';
  }
}
