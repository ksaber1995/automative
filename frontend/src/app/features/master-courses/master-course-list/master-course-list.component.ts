import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { MasterCourseService } from '../services/master-course.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { MasterCourse } from '@shared/interfaces/master-course.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-master-course-list',
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
          <h1 class="text-3xl font-bold text-gray-900">
            {{ 'MASTER_COURSES.LIST.TITLE' | translate }}
          </h1>
          <p class="text-gray-600 mt-1">
            {{ 'MASTER_COURSES.LIST.SUBTITLE' | translate }}
          </p>
        </div>
        @if (authService.canWrite('master_courses')) {
          <p-button
            [label]="'MASTER_COURSES.LIST.ADD' | translate"
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
              <th pSortableColumn="code">
                {{ 'MASTER_COURSES.LIST.COL_CODE' | translate }}
                <p-sortIcon field="code"></p-sortIcon>
              </th>
              <th pSortableColumn="name">
                {{ 'MASTER_COURSES.LIST.COL_NAME' | translate }}
                <p-sortIcon field="name"></p-sortIcon>
              </th>
              <th pSortableColumn="branchName">
                {{ 'MASTER_COURSES.LIST.COL_BRANCH' | translate }}
                <p-sortIcon field="branchName"></p-sortIcon>
              </th>
              <th>{{ 'MASTER_COURSES.LIST.COL_DEFAULT_PRICE' | translate }}</th>
              <th>{{ 'MASTER_COURSES.LIST.COL_DEFAULT_DURATION' | translate }}</th>
              <th>{{ 'MASTER_COURSES.LIST.COL_LINKED' | translate }}</th>
              <th>{{ 'MASTER_COURSES.LIST.COL_STATUS' | translate }}</th>
              <th>{{ 'MASTER_COURSES.LIST.COL_ACTIONS' | translate }}</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr>
              <td><span class="font-mono">{{ item.code }}</span></td>
              <td class="font-medium">{{ item.name }}</td>
              <td>{{ item.branchName || '—' }}</td>
              <td>{{ item.defaultPrice.toFixed(2) }}</td>
              <td>{{ item.defaultDuration }} {{ 'MASTER_COURSES.WEEKS' | translate }}</td>
              <td>
                <p-tag [value]="item.linkedCourseCount || 0" severity="info"></p-tag>
              </td>
              <td>
                <p-tag
                  [value]="item.isActive ? ('MASTER_COURSES.ACTIVE' | translate) : ('MASTER_COURSES.INACTIVE' | translate)"
                  [severity]="item.isActive ? 'success' : 'danger'"
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
                    [pTooltip]="'MASTER_COURSES.LIST.VIEW' | translate"
                  ></p-button>
                  @if (authService.canWrite('master_courses')) {
                    <p-button
                      icon="pi pi-pencil"
                      [rounded]="true"
                      [text]="true"
                      severity="warn"
                      (onClick)="edit(item)"
                      [pTooltip]="'MASTER_COURSES.LIST.EDIT' | translate"
                    ></p-button>
                  }
                  @if (authService.canDelete('master_courses') && item.isActive) {
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="confirmDelete(item)"
                      [pTooltip]="'MASTER_COURSES.LIST.DELETE' | translate"
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
                  <i class="pi pi-th-large text-4xl mb-3"></i>
                  <p>{{ 'MASTER_COURSES.LIST.EMPTY' | translate }}</p>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <app-delete-confirm-dialog
        [(visible)]="showDeleteDialog"
        [header]="'MASTER_COURSES.LIST.DELETE_TITLE' | translate"
        [message]="'MASTER_COURSES.LIST.DELETE_MSG' | translate: { name: toDelete()?.name }"
        (confirm)="doDelete()"
      ></app-delete-confirm-dialog>
    </div>
  `,
})
export class MasterCourseListComponent implements OnInit {
  private service = inject(MasterCourseService);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  authService = inject(AuthService);

  items = signal<MasterCourse[]>([]);
  loading = signal(true);
  showDeleteDialog = false;
  toDelete = signal<MasterCourse | null>(null);

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.service.getAll().subscribe({
      next: (rows) => { this.items.set(rows); this.loading.set(false); },
      error: () => { this.notifications.error('Failed to load master courses'); this.loading.set(false); },
    });
  }

  create() { this.router.navigate(['/master-courses/create']); }
  view(item: MasterCourse) { this.router.navigate(['/master-courses', item.id]); }
  edit(item: MasterCourse) { this.router.navigate(['/master-courses', item.id, 'edit']); }

  confirmDelete(item: MasterCourse) {
    this.toDelete.set(item);
    this.showDeleteDialog = true;
  }

  doDelete() {
    const item = this.toDelete();
    if (!item) return;
    this.service.delete(item.id).subscribe({
      next: () => {
        this.notifications.success('Master course deleted');
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
}
