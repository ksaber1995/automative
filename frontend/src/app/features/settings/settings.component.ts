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
  templateUrl: './settings.component.html'
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
