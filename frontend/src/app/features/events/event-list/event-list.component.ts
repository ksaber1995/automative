import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { EventService } from '../services/event.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { EventModel } from '@shared/interfaces/event.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-event-list',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    TranslateModule,
    DeleteConfirmDialogComponent,
  ],
  template: `
    <div class="container-custom py-8">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">{{ 'EVENTS.LIST.TITLE' | translate }}</h1>
          <p class="text-gray-600 mt-1">{{ 'EVENTS.LIST.SUBTITLE' | translate }}</p>
        </div>
        @if (authService.canWrite('events')) {
          <p-button
            [label]="'EVENTS.LIST.ADD' | translate"
            icon="pi pi-plus"
            (onClick)="create()"
          ></p-button>
        }
      </div>

      <p-card>
        <p-table
          [value]="items()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="10"
          responsiveLayout="scroll"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="name">
                {{ 'EVENTS.LIST.COL_NAME' | translate }}
                <p-sortIcon field="name"></p-sortIcon>
              </th>
              <th>{{ 'EVENTS.LIST.COL_TYPE' | translate }}</th>
              <th>{{ 'EVENTS.LIST.COL_LOCATION' | translate }}</th>
              <th pSortableColumn="startDate">
                {{ 'EVENTS.LIST.COL_START_DATE' | translate }}
                <p-sortIcon field="startDate"></p-sortIcon>
              </th>
              <th>{{ 'EVENTS.LIST.COL_END_DATE' | translate }}</th>
              <th>{{ 'EVENTS.LIST.COL_STATUS' | translate }}</th>
              <th>{{ 'EVENTS.LIST.COL_ACTIONS' | translate }}</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr>
              <td class="font-medium">
                {{ item.name }}
                @if (item.code) { <span class="text-gray-500 text-sm ml-1">({{ item.code }})</span> }
              </td>
              <td>
                <p-tag [value]="('EVENTS.TYPE.' + item.eventType) | translate" severity="info"></p-tag>
              </td>
              <td>{{ item.location || '—' }}</td>
              <td>{{ item.startDate | date: 'mediumDate' }}</td>
              <td>{{ item.endDate | date: 'mediumDate' }}</td>
              <td>
                <p-tag
                  [value]="('EVENTS.STATUS.' + item.status) | translate"
                  [severity]="statusSeverity(item.status)"
                ></p-tag>
              </td>
              <td>
                <div class="flex gap-2">
                  <p-button
                    icon="pi pi-eye"
                    [rounded]="true"
                    [text]="true"
                    severity="info"
                    (onClick)="view(item)"
                  ></p-button>
                  @if (authService.canWrite('events')) {
                    <p-button
                      icon="pi pi-pencil"
                      [rounded]="true"
                      [text]="true"
                      severity="warn"
                      (onClick)="edit(item)"
                    ></p-button>
                  }
                  @if (authService.canDelete('events') && item.isActive) {
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="confirmDelete(item)"
                    ></p-button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7" class="text-center py-8">
                <div class="text-gray-500">
                  <i class="pi pi-calendar text-4xl mb-3"></i>
                  <p>{{ 'EVENTS.LIST.EMPTY' | translate }}</p>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <app-delete-confirm-dialog
        [(visible)]="showDeleteDialog"
        [header]="'EVENTS.LIST.DELETE_TITLE' | translate"
        [message]="'EVENTS.LIST.DELETE_MSG' | translate: { name: toDelete()?.name }"
        (confirm)="doDelete()"
      ></app-delete-confirm-dialog>
    </div>
  `,
})
export class EventListComponent implements OnInit {
  private service = inject(EventService);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  authService = inject(AuthService);

  items = signal<EventModel[]>([]);
  loading = signal(true);
  showDeleteDialog = false;
  toDelete = signal<EventModel | null>(null);

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.service.getAll().subscribe({
      next: (rows) => { this.items.set(rows); this.loading.set(false); },
      error: () => { this.notifications.error('Failed to load events'); this.loading.set(false); },
    });
  }

  create() { this.router.navigate(['/events/create']); }
  view(item: EventModel) { this.router.navigate(['/events', item.id]); }
  edit(item: EventModel) { this.router.navigate(['/events', item.id, 'edit']); }

  confirmDelete(item: EventModel) {
    this.toDelete.set(item);
    this.showDeleteDialog = true;
  }

  doDelete() {
    const item = this.toDelete();
    if (!item) return;
    this.service.delete(item.id).subscribe({
      next: () => {
        this.notifications.success('Event deleted');
        this.showDeleteDialog = false;
        this.toDelete.set(null);
        this.load();
      },
      error: () => {
        this.notifications.error('Failed to delete');
        this.showDeleteDialog = false;
      },
    });
  }

  statusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'ACTIVE': return 'success';
      case 'PLANNED': return 'info';
      case 'COMPLETED': return 'secondary';
      case 'CANCELLED': return 'danger';
      default: return 'info';
    }
  }
}
