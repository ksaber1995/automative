import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { RadioButtonModule } from 'primeng/radiobutton';
import { FormsModule } from '@angular/forms';
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
  imports: [CommonModule, CardModule, ButtonModule, RadioButtonModule, FormsModule],
  template: `
    <div class="container mx-auto p-6 max-w-4xl">
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-gray-900">Company Settings</h1>
        <p class="text-gray-500 mt-1">Configure how your financial reports are calculated</p>
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
                <h2 class="text-xl font-bold text-gray-800">Global Expense Allocation Method</h2>
              </div>
              <p class="text-gray-500 text-sm ml-8">
                Determines how expenses with no assigned branch (global employees, shared rent, etc.)
                are distributed across your branches in financial reports.
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
                      <span class="font-bold text-gray-900 text-lg">{{ option.label }}</span>
                      <span class="text-xs font-semibold px-2 py-0.5 rounded-full" [class]="option.badgeClass">
                        {{ option.badge }}
                      </span>
                    </div>

                    <p class="text-gray-600 text-sm mb-3">{{ option.description }}</p>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div class="bg-white rounded-lg p-3 border border-gray-100">
                        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">How it works</div>
                        <p class="text-sm text-gray-700">{{ option.howItWorks }}</p>
                      </div>
                      <div class="bg-white rounded-lg p-3 border border-gray-100">
                        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Best used when</div>
                        <p class="text-sm text-gray-700">{{ option.whyUseIt }}</p>
                      </div>
                    </div>

                    @if (option.risk) {
                      <div class="mt-3 flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <i class="pi pi-exclamation-triangle mt-0.5 flex-shrink-0"></i>
                        <span>{{ option.risk }}</span>
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
                label="Save Settings"
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
      label: 'Proportional Allocation',
      badge: 'Highly Recommended',
      badgeClass: 'bg-green-100 text-green-700',
      icon: 'pi pi-chart-pie',
      iconClass: 'text-green-500',
      description: 'Global expenses are split between branches based on their share of total revenue. The more a branch earns, the more overhead it absorbs.',
      howItWorks: 'If Branch A generates 70% of revenue and Branch B generates 30%, a global salary of 10,000 → Branch A pays 7,000, Branch B pays 3,000.',
      whyUseIt: 'Best for most businesses. Prevents a small branch from being crushed by overhead it can\'t afford, while ensuring high performers carry their fair share.',
    },
    {
      value: 'EQUAL',
      label: 'Equal Split (50/50)',
      badge: 'Simple',
      badgeClass: 'bg-blue-100 text-blue-700',
      icon: 'pi pi-sliders-h',
      iconClass: 'text-blue-500',
      description: 'Global expenses are divided equally among all branches, regardless of their revenue.',
      howItWorks: 'With 2 branches, each pays exactly 50% of the global salary. With 3 branches, each pays 33.3%.',
      whyUseIt: 'Use this when the global employee truly spends equal time at each location (e.g., Monday–Tuesday at Branch A, Wednesday–Thursday at Branch B).',
      risk: 'If one branch earns much less than another, the 50% overhead hit may make it look unprofitable on paper, even if it\'s operating efficiently for its size.',
    },
    {
      value: 'OVERHEAD',
      label: 'Headquarters / Global Bucket',
      badge: 'Conservative',
      badgeClass: 'bg-purple-100 text-purple-700',
      icon: 'pi pi-building',
      iconClass: 'text-purple-500',
      description: 'Global expenses are NOT charged to any branch. They are subtracted from total company profit after branch contributions are calculated.',
      howItWorks: 'Each branch shows its "contribution" (revenue minus direct costs). Company net profit = total contribution minus global overhead.',
      whyUseIt: 'Best for executive roles (CEO, owner, accountant) whose work grows the whole company, not just one branch.',
      risk: 'Branch-level "Net Profit" will look artificially high because it doesn\'t reflect the true cost of the management layer required to run the business.',
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
