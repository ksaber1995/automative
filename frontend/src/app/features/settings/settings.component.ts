import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { RadioButtonModule } from 'primeng/radiobutton';
import { CheckboxModule } from 'primeng/checkbox';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CompanyService, GlobalExpenseAllocation } from '../../core/services/company.service';
import { NotificationService } from '../../core/services/notification.service';
import { AuthService } from '../../core/services/auth.service';

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
  imports: [CommonModule, CardModule, ButtonModule, RadioButtonModule, CheckboxModule, FormsModule, TranslateModule],
  templateUrl: './settings.component.html'
})
export class SettingsComponent implements OnInit {
  private companyService = inject(CompanyService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private authService = inject(AuthService);

  /** Individual-teacher companies have no branches, so the expense-allocation card is hidden. */
  isTeacher = (): boolean => this.authService.isTeacher();

  loading = signal(true);
  saving = signal(false);
  selectedMethod = signal<GlobalExpenseAllocation>('OVERHEAD');
  /** Opt-in: auto start/end sessions on their scheduled times. */
  autoManageSessions = signal(false);

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
        this.autoManageSessions.set(settings.autoManageSessions === true);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  save() {
    this.saving.set(true);
    this.companyService.updateSettings({
      globalExpenseAllocation: this.selectedMethod(),
      autoManageSessions: this.autoManageSessions(),
    }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('SETTINGS.SAVED'));
        this.saving.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.saving.set(false);
      }
    });
  }
}
