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
  templateUrl: './event-list.component.html',
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
