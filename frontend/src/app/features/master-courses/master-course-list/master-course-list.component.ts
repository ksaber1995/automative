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
  ],
  templateUrl: './master-course-list.component.html',
})
export class MasterCourseListComponent implements OnInit {
  private service = inject(MasterCourseService);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  authService = inject(AuthService);

  items = signal<MasterCourse[]>([]);
  loading = signal(true);

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


  toggleActive(item: MasterCourse) {
    const next = !item.isActive;
    this.service.update(item.id, { isActive: next }).subscribe({
      next: () => {
        this.notifications.success(next ? 'Master course activated' : 'Master course deactivated');
        this.load();
      },
      error: () => {
        this.notifications.error('Failed to update status');
      },
    });
  }
}
