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
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { TabsModule, Tab, TabList, TabPanel, TabPanels } from 'primeng/tabs';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { MasterCourseService } from '../services/master-course.service';
import { LevelService } from '../../levels/services/level.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { MasterCourse } from '@shared/interfaces/master-course.interface';
import { Level } from '@shared/interfaces/level.interface';

type MasterCourseRow = MasterCourse & {
  linkedCourseCount?: number;
  branchCount?: number;
  studentCount?: number;
  paidCount?: number;
  partialCount?: number;
  pendingCount?: number;
};

@Component({
  selector: 'app-master-course-list',
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
    ConfirmDialogModule,
    DialogModule,
    TabsModule,
    Tab,
    TabList,
    TabPanel,
    TabPanels,
    TranslateModule,
    AmountPipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './master-course-list.component.html',
})
export class MasterCourseListComponent implements OnInit {
  private service = inject(MasterCourseService);
  private levelService = inject(LevelService);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  items = signal<MasterCourseRow[]>([]);
  levels = signal<Level[]>([]);
  loading = signal(true);
  selectedTab = signal<'active' | 'inactive'>('active');
  selectedLevelId = signal<string | null>(null);

  // Blocker dialog: server returns 409 with `courses` (linked courses still active).
  showBlockerDialog = signal(false);
  blockerName = signal('');
  blockerCourses = signal<{ id: string; name: string }[]>([]);

  levelOptions = computed(() => this.levels().map(l => ({ label: l.name, value: l.id })));

  private byLevel = computed(() => {
    const level = this.selectedLevelId();
    return this.items().filter(i => level === null ? true : i.levelId === level);
  });

  activeCount = computed(() => this.byLevel().filter(i => i.isActive).length);
  inactiveCount = computed(() => this.byLevel().filter(i => !i.isActive).length);
  filteredItems = computed(() => {
    const wantActive = this.selectedTab() === 'active';
    return this.byLevel().filter(i => i.isActive === wantActive);
  });

  ngOnInit() {
    this.load();
    this.levelService.getAllLevels().subscribe({
      next: (rows) => this.levels.set(rows),
    });
  }

  clearFilters() {
    this.selectedLevelId.set(null);
  }

  load() {
    this.loading.set(true);
    this.service.getAll().subscribe({
      next: (rows) => { this.items.set(rows as MasterCourseRow[]); this.loading.set(false); },
      error: () => { this.notifications.error('Failed to load master courses'); this.loading.set(false); },
    });
  }

  create() { this.router.navigate(['/master-courses/create']); }
  view(item: MasterCourse) { this.router.navigate(['/master-courses', item.id]); }
  edit(item: MasterCourse) { this.router.navigate(['/master-courses', item.id, 'edit']); }

  canDelete(item: MasterCourseRow): boolean {
    return (item.studentCount || 0) === 0;
  }

  deleteItem(item: MasterCourseRow) {
    this.confirmationService.confirm({
      header: this.translate.instant('MASTER_COURSES.LIST.DELETE_TITLE'),
      message: this.translate.instant('MASTER_COURSES.LIST.DELETE_MSG', { name: item.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.service.delete(item.id).subscribe({
          next: () => {
            this.notifications.success(this.translate.instant('MASTER_COURSES.DELETED'));
            this.load();
          },
        });
      },
    });
  }

  deactivate(item: MasterCourseRow) {
    this.confirmationService.confirm({
      header: this.translate.instant('MASTER_COURSES.LIST.DEACTIVATE_TITLE'),
      message: this.translate.instant('MASTER_COURSES.LIST.DEACTIVATE_MSG', { name: item.name }),
      icon: 'pi pi-ban',
      accept: () => {
        this.service.deactivate(item.id).subscribe({
          next: () => {
            this.notifications.success(this.translate.instant('MASTER_COURSES.LIST.DEACTIVATED'));
            this.load();
          },
          error: (err) => {
            const body = err?.error;
            if (err?.status === 409 && Array.isArray(body?.courses)) {
              this.blockerName.set(item.name);
              this.blockerCourses.set(body.courses);
              this.showBlockerDialog.set(true);
            }
          },
        });
      },
    });
  }

  openBlockingCourse(c: { id: string }) {
    this.showBlockerDialog.set(false);
    this.router.navigate(['/courses', c.id]);
  }

  activate(item: MasterCourseRow) {
    this.service.activate(item.id).subscribe({
      next: () => {
        this.notifications.success(this.translate.instant('MASTER_COURSES.LIST.ACTIVATED'));
        this.load();
      },
    });
  }
}
