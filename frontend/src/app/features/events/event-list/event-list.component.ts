import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EventService } from '../services/event.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { EventModel } from '@shared/interfaces/event.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-event-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    SelectModule,
    TranslateModule,
    DeleteConfirmDialogComponent,
  ],
  templateUrl: './event-list.component.html',
})
export class EventListComponent implements OnInit {
  private service = inject(EventService);
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  items = signal<EventModel[]>([]);
  branches = signal<LookupOption[]>([]);
  loading = signal(true);
  showDeleteDialog = false;
  toDelete = signal<EventModel | null>(null);

  selectedBranchId = signal<string | null>(null);
  // 'ACTIVE' = isActive && endDate not yet passed, 'FINISHED' = endDate < today,
  // 'INACTIVE' = soft-deleted/cancelled (isActive === false). `null` = all.
  selectedStatus = signal<'ACTIVE' | 'INACTIVE' | 'FINISHED' | null>(null);

  // Backend already scopes /api/events to the caller's accessible branches
  // (or all branches for global admins), so the dropdown just mirrors what
  // the user can see. Events with branch_id IS NULL are "company-wide"
  // and selectable via the dedicated __global__ option.
  branchOptions = computed(() => [
    { label: this.translate.instant('EVENTS.LIST.GLOBAL_NO_BRANCH'), value: '__global__' },
    ...this.branches().map(b => ({ label: b.label, value: b.id })),
  ]);

  statusOptions = computed(() => [
    { label: this.translate.instant('EVENTS.LIST.STATUS_ACTIVE'), value: 'ACTIVE' },
    { label: this.translate.instant('EVENTS.LIST.STATUS_INACTIVE'), value: 'INACTIVE' },
    { label: this.translate.instant('EVENTS.LIST.STATUS_FINISHED'), value: 'FINISHED' },
  ]);

  filteredItems = computed(() => {
    const branch = this.selectedBranchId();
    const status = this.selectedStatus();
    const todayKey = new Date().toISOString().split('T')[0];

    return this.items().filter((e) => {
      if (branch === '__global__' && e.branchId !== null) return false;
      if (branch && branch !== '__global__' && e.branchId !== branch) return false;

      if (status) {
        const finished = !!e.endDate && e.endDate < todayKey;
        if (status === 'FINISHED' && !finished) return false;
        if (status === 'ACTIVE' && (!e.isActive || finished)) return false;
        if (status === 'INACTIVE' && e.isActive) return false;
      }
      return true;
    });
  });

  isFinished(item: EventModel): boolean {
    const todayKey = new Date().toISOString().split('T')[0];
    return !!item.endDate && item.endDate < todayKey;
  }

  ngOnInit() {
    this.load();
    this.lookupService.branches().subscribe({
      next: (b) => this.branches.set(b),
    });
  }

  load() {
    this.loading.set(true);
    this.service.getAll().subscribe({
      next: (rows) => { this.items.set(rows); this.loading.set(false); },
      error: () => { this.notifications.error('Failed to load events'); this.loading.set(false); },
    });
  }

  getBranchName(branchId: string | null): string {
    if (!branchId) return this.translate.instant('EVENTS.LIST.GLOBAL');
    return this.branches().find(b => b.id === branchId)?.label ?? branchId;
  }

  clearFilters() {
    this.selectedBranchId.set(null);
    this.selectedStatus.set(null);
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
