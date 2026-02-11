import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    AvatarModule,
    MenuModule
  ],
  template: `
    <div class="min-h-screen bg-gray-100">
      <!-- Top Header -->
      <header class="bg-white shadow-sm border-b border-gray-200 fixed top-0 left-0 right-0 z-10">
        <div class="flex items-center justify-between px-6 py-4">
          <div class="flex items-center gap-4">
            <button
              pButton
              icon="pi pi-bars"
              class="p-button-text p-button-rounded"
              (click)="toggleSidebar()">
            </button>
            <h1 class="text-2xl font-bold text-blue-600">Automate Magic</h1>
          </div>

          <div class="flex items-center gap-4">
            @if (currentUser(); as user) {
              <div class="flex items-center gap-3">
                <div class="text-right">
                  <p class="font-medium text-gray-900">{{ user.firstName }} {{ user.lastName }}</p>
                  <p class="text-sm text-gray-500">{{ user.role }}</p>
                </div>
                <p-avatar
                  [label]="getUserInitials(user)"
                  styleClass="bg-blue-500 text-white"
                  shape="circle">
                </p-avatar>
              </div>
            }
            <button
              pButton
              icon="pi pi-sign-out"
              label="Logout"
              class="p-button-text"
              (click)="logout()">
            </button>
          </div>
        </div>
      </header>

      <!-- Sidebar -->
      <aside
        class="fixed left-0 top-16 bottom-0 bg-white border-r border-gray-200 transition-all duration-300 z-20"
        [class.w-64]="sidebarVisible()"
        [class.w-0]="!sidebarVisible()">
        @if (sidebarVisible()) {
          <nav class="p-4">
            <div class="space-y-1">
              @for (item of menuItems; track $index) {
                @if (item.separator) {
                  <div class="border-t border-gray-200 my-2"></div>
                  @if (item.label) {
                    <div class="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {{ item.label }}
                    </div>
                  }
                } @else {
                  <a
                    [routerLink]="item.routerLink"
                    routerLinkActive="bg-blue-50 text-blue-600 border-blue-600"
                    class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors border-l-4 border-transparent"
                    [class.pointer-events-none]="!item.visible">
                    <i [class]="item.icon + ' text-lg'"></i>
                    <span class="font-medium">{{ item.label }}</span>
                  </a>
                }
              }
            </div>
          </nav>
        }
      </aside>

      <!-- Main Content -->
      <main
        class="pt-16 transition-all duration-300"
        [class.ml-64]="sidebarVisible()"
        [class.ml-0]="!sidebarVisible()">
        <div class="p-6">
          <router-outlet></router-outlet>
        </div>
      </main>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class LayoutComponent {
  sidebarVisible = signal(true);
  currentUser = this.authService.currentUser;

  menuItems: MenuItem[] = [
    {
      label: 'Dashboard',
      icon: 'pi pi-home',
      routerLink: ['/dashboard'],
      visible: true
    },
    {
      separator: true,
      label: 'Management'
    },
    {
      label: 'Branches',
      icon: 'pi pi-building',
      routerLink: ['/branches'],
      visible: true
    },
    {
      label: 'Courses',
      icon: 'pi pi-book',
      routerLink: ['/courses'],
      visible: true
    },
    {
      label: 'Classes',
      icon: 'pi pi-calendar',
      routerLink: ['/classes'],
      visible: true
    },
    {
      label: 'Students',
      icon: 'pi pi-users',
      routerLink: ['/students'],
      visible: true
    },
    {
      label: 'Employees',
      icon: 'pi pi-user',
      routerLink: ['/employees'],
      visible: true
    },
    {
      separator: true,
      label: 'Financial'
    },
    {
      label: 'Revenues',
      icon: 'pi pi-dollar',
      routerLink: ['/revenues'],
      visible: true
    },
    {
      label: 'Expenses',
      icon: 'pi pi-money-bill',
      routerLink: ['/expenses'],
      visible: true
    },
    {
      label: 'Withdrawals',
      icon: 'pi pi-wallet',
      routerLink: ['/withdrawals'],
      visible: true
    },
    {
      label: 'Debts',
      icon: 'pi pi-credit-card',
      routerLink: ['/debts'],
      visible: true
    },
    {
      separator: true,
      label: 'Inventory'
    },
    {
      label: 'Products',
      icon: 'pi pi-box',
      routerLink: ['/products/list'],
      visible: true
    },
    {
      label: 'Sell Product',
      icon: 'pi pi-shopping-cart',
      routerLink: ['/products/sell'],
      visible: true
    },
    {
      label: 'Sales History',
      icon: 'pi pi-history',
      routerLink: ['/products/sales'],
      visible: true
    },
    {
      separator: true
    },
    {
      label: 'Reports',
      icon: 'pi pi-chart-bar',
      routerLink: ['/reports'],
      visible: true
    }
  ];

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  toggleSidebar() {
    this.sidebarVisible.update(v => !v);
  }

  getUserInitials(user: any): string {
    return `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase();
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/auth/login']);
  }
}
