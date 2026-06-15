import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { TabsModule } from 'primeng/tabs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ClassService } from '../services/class.service';
import { CourseService } from '../services/course.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { ClassStatus, ClassWithDetails } from '@shared/interfaces/class.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-class-list',
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
    TabsModule,
    TranslateModule,
    DeleteConfirmDialogComponent
  ],
  templateUrl: './class-list.component.html'
})
export class ClassListComponent implements OnInit {
  private classService = inject(ClassService);
  private courseService = inject(CourseService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  protected branchState = inject(BranchStateService);

  classes = signal<ClassWithDetails[]>([]);
  courses = signal<any[]>([]);
  branches = signal<any[]>([]);
  loading = signal(true);
  showDeleteDialog = false;
  classToDelete = signal<ClassWithDetails | null>(null);
  activeStatus = signal<ClassStatus>('IN_PROGRESS');

  filteredClasses = () => this.classes().filter(c => (c.status ?? this.deriveStatus(c)) === this.activeStatus());

  countByStatus(status: ClassStatus): number {
    return this.classes().filter(c => (c.status ?? this.deriveStatus(c)) === status).length;
  }

  onStatusTabChange(val: string | number | undefined) {
    const v = (val?.toString() ?? 'IN_PROGRESS') as ClassStatus;
    this.activeStatus.set(v);
  }

  statusLabel(status?: ClassStatus | string): string {
    switch (status) {
      case 'IN_PROGRESS': return this.translate.instant('CLASSES.LIST.STATUS_IN_PROGRESS');
      case 'SCHEDULED': return this.translate.instant('CLASSES.LIST.STATUS_SCHEDULED');
      case 'DONE': return this.translate.instant('CLASSES.LIST.STATUS_DONE');
      default: return this.translate.instant('CLASSES.LIST.STATUS_UNKNOWN');
    }
  }

  statusSeverity(status?: ClassStatus | string): 'success' | 'info' | 'secondary' | 'warn' {
    switch (status) {
      case 'IN_PROGRESS': return 'success';
      case 'SCHEDULED': return 'info';
      case 'DONE': return 'secondary';
      default: return 'warn';
    }
  }

  private deriveStatus(c: ClassWithDetails): ClassStatus {
    if (c.isFinished) return 'DONE';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (c.startDate && new Date(c.startDate).getTime() > today.getTime()) return 'SCHEDULED';
    return 'IN_PROGRESS';
  }

  // Filter from route params (when viewing classes for a specific course)
  filterByCourseId: string | null = null;

  // User-selected filters
  selectedCourseId: string | null = null;
  selectedBranchId: string | null = null;

  ngOnInit() {
    // Check if we're filtering by course from route params
    this.filterByCourseId = this.route.snapshot.paramMap.get('courseId');

    this.loadCourses();
    this.loadBranches();
    this.loadClasses();
  }

  loadCourses() {
    this.courseService.getActiveCourses().subscribe({
      next: (courses) => {
        this.courses.set([
          { label: this.translate.instant('CLASSES.LIST.ALL_COURSES'), value: null },
          ...courses.map(c => ({ label: c.name, value: c.id }))
        ]);
      }
    });
  }

  loadBranches() {
    // Filter dropdowns: show every branch the user can access (active and
    // inactive). Hiding inactive branches here would prevent admins from
    // filtering existing data in a branch they've since deactivated.
    this.branchService.getAllBranches().subscribe({
      next: (branches) => {
        this.branches.set([
          { label: this.translate.instant('CLASSES.LIST.ALL_BRANCHES'), value: null },
          ...branches.map(b => ({ label: b.name, value: b.id }))
        ]);
      }
    });
  }

  loadClasses() {
    this.loading.set(true);
    const courseId = this.filterByCourseId || this.selectedCourseId;
    const branchId = this.selectedBranchId;

    if (courseId) {
      this.classService.getClassesByCourse(courseId).subscribe({
        next: (classes) => {
          this.classes.set(this.filterByBranch(classes, branchId));
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      });
    } else if (branchId) {
      this.classService.getClassesByBranch(branchId).subscribe({
        next: (classes) => {
          this.classes.set(classes);
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      });
    } else {
      this.classService.getAllClasses().subscribe({
        next: (classes) => {
          this.classes.set(classes);
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      });
    }
  }

  filterByBranch(classes: any[], branchId: string | null) {
    if (!branchId) return classes;
    return classes.filter(c => c.branchId === branchId);
  }

  onFilterChange() {
    this.loadClasses();
  }

  clearFilters() {
    this.selectedCourseId = null;
    this.selectedBranchId = null;
    this.loadClasses();
  }

  viewClass(classItem: ClassWithDetails) {
    this.router.navigate(['/classes', classItem.id]);
  }

  editClass(classItem: ClassWithDetails) {
    this.router.navigate(['/courses', classItem.courseId, 'classes', classItem.id, 'edit']);
  }

  confirmDelete(classItem: ClassWithDetails) {
    this.classToDelete.set(classItem);
    this.showDeleteDialog = true;
  }

  deleteClass() {
    const classItem = this.classToDelete();
    if (!classItem) return;

    this.classService.deleteClass(classItem.id).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('CLASSES.DELETED'));
        this.loadClasses();
        this.showDeleteDialog = false;
        this.classToDelete.set(null);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.showDeleteDialog = false;
      }
    });
  }

  createClass() {
    const courseId = this.filterByCourseId || this.selectedCourseId;
    if (courseId) {
      this.router.navigate(['/courses', courseId, 'classes', 'create']);
    } else {
      this.router.navigate(['/classes/create']);
    }
  }

  selectCourseForNewClass() {
    this.router.navigate(['/classes/create']);
  }

  formatDaysOfWeek(days: string): string {
    if (!days) return '';
    const dayList = days.split(',').map(d => d.trim());
    const shortDays = dayList.map(d => {
      return this.translate.instant('CLASSES.LIST.DAY_' + d);
    });
    return shortDays.join(', ');
  }

  formatDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
