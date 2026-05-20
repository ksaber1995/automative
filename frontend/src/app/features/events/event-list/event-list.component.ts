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
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { EventModel } from '@shared/interfaces/event.interface';
import { Branch } from '@shared/interfaces/branch.interface';
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
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  items = signal<EventModel[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  showDeleteDialog = false;
  toDelete = signal<EventModel | null>(null);

  selectedBranchId = signal<string | null>(null);

  // Backend already scopes /api/events to the caller's accessible branches
  // (or all branches for global admins), so the dropdown just mirrors what
  // the user can see. Events with branch_id IS NULL are "company-wide"
  // and selectable via the dedicated __global__ option.
  branchOptions = computed(() => [
    { label: this.translate.instant('EVENTS.LIST.GLOBAL_NO_BRANCH'), value: '__global__' },
    ...this.branches().map(b => ({ label: b.name, value: b.id })),
  ]);

  filteredItems = computed(() => {
    const branch = this.selectedBranchId();
    if (branch === null) return this.items();
    if (branch === '__global__') return this.items().filter(e => e.branchId === null);
    return this.items().filter(e => e.branchId === branch);
  });

  ngOnInit() {
    this.load();
    this.branchService.getAllBranches().subscribe({
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
    return this.branches().find(b => b.id === branchId)?.name ?? branchId;
  }

  clearFilters() {
    this.selectedBranchId.set(null);
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
