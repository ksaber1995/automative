import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { RadioButtonModule } from 'primeng/radiobutton';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { CompanyService, GlobalExpenseAllocation } from '../../core/services/company.service';
import { NotificationService } from '../../core/services/notification.service';

interface AllocationOption {
  value: GlobalExpenseAllocation;
  label: string;
  badge: string;
  badgeClass: string;
  icon: string;
  iconClass: string;
  description: string;
  howItWorks: string;
  whyUseIt: string;
  risk?: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, RadioButtonModule, FormsModule, TranslateModule],
  template: `
    <div class="container mx-auto p-6 max-w-4xl">
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-gray-900">{{ 'SETTINGS.TITLE' | translate }}</h1>
        <p class="text-gray-500 mt-1">{{ 'SETTINGS.SUBTITLE' | translate }}</p>
      </div>

      @if (loading()) {
        <div class="flex justify-center py-20">
          <i class="pi pi-spin pi-spinner text-4xl text-gray-400"></i>
        </div>
      } @else {
        <!-- Global Expense Allocation -->
        <p-card>
          <ng-template pTemplate="header">
            <div class="px-6 pt-6 pb-2">
              <div class="flex items-center gap-3 mb-1">
                <i class="pi pi-sitemap text-blue-500 text-xl"></i>
                <h2 class="text-xl font-bold text-gray-800">{{ 'SETTINGS.ALLOCATION_TITLE' | translate }}</h2>
              </div>
              <p class="text-gray-500 text-sm ml-8">
                {{ 'SETTINGS.ALLOCATION_DESC' | translate }}
              </p>
            </div>
          </ng-template>

          <div class="space-y-4 pb-2">
            @for (option of allocationOptions; track option.value) {
              <div
                class="border-2 rounded-xl p-5 cursor-pointer transition-all"
                [class.border-blue-500]="selectedMethod() === option.value"
                [class.bg-blue-50]="selectedMethod() === option.value"
                [class.border-gray-200]="selectedMethod() !== option.value"
                [class.hover:border-gray-300]="selectedMethod() !== option.value"
                (click)="selectedMethod.set(option.value)">

                <div class="flex items-start gap-4">
                  <p-radioButton
                    [name]="'allocation'"
                    [value]="option.value"
                    [(ngModel)]="selectedMethodValue"
                    (onClick)="selectedMethod.set(option.value)">
                  </p-radioButton>

                  <div class="flex-1">
                    <div class="flex items-center gap-3 mb-2">
                      <i [class]="option.icon + ' text-xl ' + option.iconClass"></i>
                      <span class="font-bold text-gray-900 text-lg">{{ option.label | translate }}</span>
                      <span class="text-xs font-semibold px-2 py-0.5 rounded-full" [class]="option.badgeClass">
                        {{ option.badge | translate }}
                      </span>
                    </div>

                    <p class="text-gray-600 text-sm mb-3">{{ option.description | translate }}</p>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div class="bg-white rounded-lg p-3 border border-gray-100">
                        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{{ 'SETTINGS.HOW_IT_WORKS' | translate }}</div>
                        <p class="text-sm text-gray-700">{{ option.howItWorks | translate }}</p>
                      </div>
                      <div class="bg-white rounded-lg p-3 border border-gray-100">
                        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{{ 'SETTINGS.BEST_USED_WHEN' | translate }}</div>
                        <p class="text-sm text-gray-700">{{ option.whyUseIt | translate }}</p>
                      </div>
                    </div>

                    @if (option.risk) {
                      <div class="mt-3 flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <i class="pi pi-exclamation-triangle mt-0.5 flex-shrink-0"></i>
                        <span>{{ option.risk | translate }}</span>
                      </div>
                    }
                  </div>
                </div>
              </div>
            }
          </div>

          <ng-template pTemplate="footer">
            <div class="flex justify-end pt-2">
              <p-button
                [label]="'SETTINGS.SAVE' | translate"
                icon="pi pi-check"
                [loading]="saving()"
                (onClick)="save()">
              </p-button>
            </div>
          </ng-template>
        </p-card>
      }
    </div>
  `
})
export class SettingsComponent implements OnInit {
  private companyService = inject(CompanyService);
  private notificationService = inject(NotificationService);

  loading = signal(true);
  saving = signal(false);
  selectedMethod = signal<GlobalExpenseAllocation>('OVERHEAD');

  get selectedMethodValue(): GlobalExpenseAllocation {
    return this.selectedMethod();
  }
  set selectedMethodValue(v: GlobalExpenseAllocation) {
    this.selectedMethod.set(v);
  }

  allocationOptions: AllocationOption[] = [
    {
      value: 'PROPORTIONAL',
      label: 'SETTINGS.PROPORTIONAL_TITLE',
      badge: 'SETTINGS.PROPORTIONAL_BADGE',
      badgeClass: 'bg-green-100 text-green-700',
      icon: 'pi pi-chart-pie',
      iconClass: 'text-green-500',
      description: 'SETTINGS.PROPORTIONAL_DESC',
      howItWorks: 'SETTINGS.PROPORTIONAL_EXAMPLE',
      whyUseIt: 'SETTINGS.PROPORTIONAL_BEST',
    },
    {
      value: 'EQUAL',
      label: 'SETTINGS.EQUAL_TITLE',
      badge: 'SETTINGS.EQUAL_BADGE',
      badgeClass: 'bg-blue-100 text-blue-700',
      icon: 'pi pi-sliders-h',
      iconClass: 'text-blue-500',
      description: 'SETTINGS.EQUAL_DESC',
      howItWorks: 'SETTINGS.EQUAL_EXAMPLE',
      whyUseIt: 'SETTINGS.EQUAL_BEST',
      risk: 'SETTINGS.EQUAL_WARNING',
    },
    {
      value: 'OVERHEAD',
      label: 'SETTINGS.OVERHEAD_TITLE',
      badge: 'SETTINGS.OVERHEAD_BADGE',
      badgeClass: 'bg-purple-100 text-purple-700',
      icon: 'pi pi-building',
      iconClass: 'text-purple-500',
      description: 'SETTINGS.OVERHEAD_DESC',
      howItWorks: 'SETTINGS.OVERHEAD_EXAMPLE',
      whyUseIt: 'SETTINGS.OVERHEAD_BEST',
      risk: 'SETTINGS.OVERHEAD_WARNING',
    },
  ];

  ngOnInit() {
    this.companyService.getSettings().subscribe({
      next: (settings) => {
        this.selectedMethod.set(settings.globalExpenseAllocation);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  save() {
    this.saving.set(true);
    this.companyService.updateSettings({ globalExpenseAllocation: this.selectedMethod() }).subscribe({
      next: () => {
        this.notificationService.success('Settings saved successfully');
        this.saving.set(false);
      },
      error: (err) => {
        this.notificationService.error(err?.error?.message || 'Failed to save settings');
        this.saving.set(false);
      }
    });
  }
}
