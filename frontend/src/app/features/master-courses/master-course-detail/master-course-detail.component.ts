import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { MasterCourseService, AvailableCourse } from '../services/master-course.service';
import { MasterEnrollmentService } from '../services/master-enrollment.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  MasterCourse,
  LinkedCourseSummary,
} from '@shared/interfaces/master-course.interface';
import { MasterEnrollmentProgress } from '@shared/interfaces/master-enrollment.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-master-course-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    DialogModule,
    SelectModule,
    TooltipModule,
    TranslateModule,
    DeleteConfirmDialogComponent,
  ],
  templateUrl: './master-course-detail.component.html',
})
export class MasterCourseDetailComponent implements OnInit {
  private service = inject(MasterCourseService);
  private enrollmentService = inject(MasterEnrollmentService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  authService = inject(AuthService);

  id!: string;
  master = signal<MasterCourse | null>(null);
  linked = signal<LinkedCourseSummary[] | null>(null);
  loadingLinked = signal(true);

  showAddDialog = false;
  available = signal<AvailableCourse[] | null>(null);
  loadingAvailable = signal(false);
  pickedCourseId: string | null = null;
  adding = signal(false);

  enrollments = signal<MasterEnrollmentProgress[] | null>(null);
  loadingEnrollments = signal(true);

  showRemoveDialog = false;
  toRemove = signal<LinkedCourseSummary | null>(null);
  showDeleteDialog = false;

  sumOfLinked = computed(() =>
    (this.linked() || []).reduce((sum, c) => sum + (c.price || 0), 0)
  );
  savings = computed(() => this.sumOfLinked() - (this.master()?.defaultPrice || 0));

  ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id')!;
    this.loadMaster();
    this.loadLinked();
    this.loadEnrollments();
  }

  loadMaster() {
    this.service.getById(this.id).subscribe({
      next: (m) => this.master.set(m),
      error: () => {
        this.notifications.error('Failed to load master course');
        this.router.navigate(['/master-courses']);
      },
    });
  }

  loadLinked() {
    this.loadingLinked.set(true);
    this.service.getLinkedCourses(this.id).subscribe({
      next: (rows) => { this.linked.set(rows); this.loadingLinked.set(false); },
      error: () => { this.loadingLinked.set(false); },
    });
  }

  loadEnrollments() {
    this.loadingEnrollments.set(true);
    this.enrollmentService.listByMaster(this.id).subscribe({
      next: (rows) => { this.enrollments.set(rows); this.loadingEnrollments.set(false); },
      error: () => { this.loadingEnrollments.set(false); },
    });
  }

  openAddDialog() {
    this.pickedCourseId = null;
    this.available.set(null);
    this.loadingAvailable.set(true);
    this.showAddDialog = true;
    this.service.getAvailableCourses(this.id).subscribe({
      next: (rows) => { this.available.set(rows); this.loadingAvailable.set(false); },
      error: () => { this.loadingAvailable.set(false); this.available.set([]); },
    });
  }

  doAdd() {
    if (!this.pickedCourseId) return;
    this.adding.set(true);
    this.service.addCourse(this.id, this.pickedCourseId).subscribe({
      next: () => {
        this.adding.set(false);
        this.showAddDialog = false;
        this.notifications.success('Course added to master');
        this.loadLinked();
      },
      error: (err) => {
        this.adding.set(false);
        this.notifications.error(err?.error?.message || 'Failed to add course');
      },
    });
  }

  confirmRemove(row: LinkedCourseSummary) {
    this.toRemove.set(row);
    this.showRemoveDialog = true;
  }

  doRemove() {
    const row = this.toRemove();
    if (!row) return;
    this.service.removeCourse(this.id, row.id).subscribe({
      next: () => {
        this.notifications.success('Course removed');
        this.showRemoveDialog = false;
        this.toRemove.set(null);
        this.loadLinked();
      },
      error: (err) => {
        this.notifications.error(err?.error?.message || 'Failed to remove');
        this.showRemoveDialog = false;
      },
    });
  }

  toggleActive() {
    const m = this.master();
    if (!m) return;
    const next = !m.isActive;
    this.service.update(this.id, { isActive: next }).subscribe({
      next: () => {
        this.notifications.success(next ? 'Master course activated' : 'Master course deactivated');
        this.loadMaster();
      },
      error: () => this.notifications.error('Failed to update status'),
    });
  }

  confirmDelete() { this.showDeleteDialog = true; }

  doDelete() {
    this.service.delete(this.id).subscribe({
      next: () => {
        this.notifications.success('Master course deleted');
        this.showDeleteDialog = false;
        this.router.navigate(['/master-courses']);
      },
      error: () => {
        this.notifications.error('Failed to delete master course');
        this.showDeleteDialog = false;
      },
    });
  }

  edit() { this.router.navigate(['/master-courses', this.id, 'edit']); }
  back() { this.router.navigate(['/master-courses']); }
}
