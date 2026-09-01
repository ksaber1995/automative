import { TablePageUxDirective } from '../../../core/directives/table-page-ux.directive';
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { TabsModule } from 'primeng/tabs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ClassService } from '../services/class.service';
import { AuthService } from '../../../core/services/auth.service';
import { LookupService } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { ClassStatus, ClassWithDetails } from '@shared/interfaces/class.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';
import { TablePageMemory } from '../../../core/utils/table-page-memory';

@Component({
  selector: 'app-class-list',
  standalone: true,
  imports: [
    TablePageUxDirective,
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TooltipModule,
    SelectModule,
    DialogModule,
    TabsModule,
    TranslateModule,
    DeleteConfirmDialogComponent
  ],
  templateUrl: './class-list.component.html'
})
export class ClassListComponent implements OnInit {
  private classService = inject(ClassService);
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private auth = inject(AuthService);
  protected branchState = inject(BranchStateService);

  /**
   * Rooms, branches and "which instructor" are academy concerns. A solo TEACHER
   * tenant has no Rooms page (already hidden in the nav), one branch and one
   * teacher — themselves — so those columns are three dashes and a repeated name,
   * and the row checkboxes exist only to arm a bulk room assignment whose
   * dropdown is always empty.
   */
  showAcademyColumns = () => !this.auth.isTeacher();

  classes = signal<ClassWithDetails[]>([]);
  courses = signal<any[]>([]);
  branches = signal<any[]>([]);
  loading = signal(true);

  /**
   * The table position rides the URL (?page=6) and sessionStorage, so creating
   * or editing a class on page 6 returns to page 6 — not back to page 1.
   */
  pageMem = new TablePageMemory(this.router, this.route, {
    storeKey: 'classes-list-page',
    defaultRows: 10,
    allowedRows: [10, 25, 50],
  });

  // Bulk "put these classes in this room". Rooms landed on classes long after the
  // classes did, so an existing timetable has to be filled in — one edit page at a
  // time would be dozens of round trips through a form.
  selectedClasses: ClassWithDetails[] = [];
  rooms = signal<any[]>([]);
  assignRoomDialogOpen = signal(false);
  assignRoomId: string | null = null;
  assigningRoom = signal(false);
  showDeleteDialog = false;
  classToDelete = signal<ClassWithDetails | null>(null);
  activeStatus = signal<ClassStatus>('IN_PROGRESS');

  filteredClasses = () => this.classes().filter(c => (c.status ?? this.deriveStatus(c)) === this.activeStatus());

  /** studentCount is the enriched field; currentEnrollment is the older name. */
  enrolledCount(c: ClassWithDetails): number {
    return (c as any).studentCount ?? (c as any).currentEnrollment ?? 0;
  }

  /**
   * Nothing stops an enrollment once a class is full — maxStudents is a plan, not
   * a lock — so a room can quietly end up over its seats. Flag it on the list
   * rather than leaving "13 / 12" to be read as ordinary.
   */
  isOverCapacity(c: ClassWithDetails): boolean {
    return !!c.maxStudents && this.enrolledCount(c) > c.maxStudents;
  }

  overCapacityBy(c: ClassWithDetails): number {
    return this.enrolledCount(c) - (c.maxStudents || 0);
  }

  countByStatus(status: ClassStatus): number {
    return this.classes().filter(c => (c.status ?? this.deriveStatus(c)) === status).length;
  }

  onStatusTabChange(val: string | number | undefined) {
    const v = (val?.toString() ?? 'IN_PROGRESS') as ClassStatus;
    this.activeStatus.set(v);
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
    if (this.showAcademyColumns()) this.loadRooms();
    this.loadClasses();
  }

  loadRooms() {
    this.lookupService.rooms().subscribe({
      next: (rooms) => this.rooms.set(rooms.map(r => ({ label: r.label, value: r.id }))),
    });
  }

  openAssignRoom() {
    if (!this.selectedClasses.length) return;
    this.assignRoomId = null;
    this.assignRoomDialogOpen.set(true);
  }

  /** `assignRoomId` of null clears the room on every selected class. */
  confirmAssignRoom() {
    const ids = this.selectedClasses.map(c => c.id);
    if (!ids.length) return;
    this.assigningRoom.set(true);
    this.classService.assignRoom(ids, this.assignRoomId).subscribe({
      next: (res) => {
        this.assigningRoom.set(false);
        this.assignRoomDialogOpen.set(false);
        this.selectedClasses = [];
        this.notificationService.success(
          this.translate.instant('CLASSES.LIST.ROOM_ASSIGNED', { count: res.updated })
        );
        this.loadClasses();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.assigningRoom.set(false);
      },
    });
  }

  loadCourses() {
    this.lookupService.courses().subscribe({
      next: (courses) => {
        this.courses.set([
          { label: this.translate.instant('CLASSES.LIST.ALL_COURSES'), value: null },
          ...courses.map(c => ({ label: c.label, value: c.id }))
        ]);
      }
    });
  }

  loadBranches() {
    // Filter dropdowns: show every branch the user can access (active and
    // inactive). Hiding inactive branches here would prevent admins from
    // filtering existing data in a branch they've since deactivated.
    this.lookupService.branches().subscribe({
      next: (branches) => {
        this.branches.set([
          { label: this.translate.instant('CLASSES.LIST.ALL_BRANCHES'), value: null },
          ...branches.map(b => ({ label: b.label, value: b.id }))
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

  /**
   * "2:00 PM" from the stored "14:00" / "14:00:00". Same en-US locale as
   * formatDate, so both halves of the schedule column read the same way.
   * Anything unparseable falls through as-is rather than showing "Invalid Date".
   */
  formatTime(time: string): string {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return time;
    const date = new Date();
    date.setHours(h, m, 0, 0);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}
