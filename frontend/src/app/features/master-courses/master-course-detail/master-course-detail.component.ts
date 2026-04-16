import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TranslateModule } from '@ngx-translate/core';
import { MasterCourseService } from '../services/master-course.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  MasterCourse,
  LinkedCourseSummary,
} from '@shared/interfaces/master-course.interface';
import { Branch } from '@shared/interfaces/branch.interface';

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
    CheckboxModule,
    TooltipModule,
    InputTextModule,
    SelectModule,
    TranslateModule,
  ],
  template: `
    <div class="container-custom py-8">
      <div class="mb-6 flex justify-between items-start">
        <div>
          <p-button
            icon="pi pi-arrow-left"
            [text]="true"
            [label]="'MASTER_COURSES.DETAIL.BACK' | translate"
            (onClick)="back()"
          ></p-button>
          <h1 class="text-3xl font-bold text-gray-900 mt-2">
            {{ master()?.name }}
          </h1>
          <p class="text-gray-600 font-mono">{{ master()?.code }}</p>
          @if (master()?.branchName) {
            <p class="text-sm text-gray-500 mt-1">
              <i class="pi pi-building mr-1"></i>{{ master()?.branchName }}
            </p>
          }
        </div>
        @if (master() && authService.canWrite('master_courses')) {
          <div class="flex gap-2 flex-wrap">
            <p-button
              icon="pi pi-pencil"
              [label]="'MASTER_COURSES.DETAIL.EDIT' | translate"
              severity="secondary"
              [outlined]="true"
              (onClick)="edit()"
            ></p-button>
            <p-button
              icon="pi pi-sitemap"
              [label]="'MASTER_COURSES.DETAIL.INSTANTIATE' | translate"
              severity="info"
              [disabled]="alreadyInstantiated()"
              [pTooltip]="alreadyInstantiated() ? ('MASTER_COURSES.DETAIL.ALREADY_INSTANTIATED' | translate) : ''"
              (onClick)="doInstantiate()"
            ></p-button>
            <p-button
              icon="pi pi-copy"
              [label]="'MASTER_COURSES.DETAIL.CLONE' | translate"
              severity="help"
              [outlined]="true"
              (onClick)="openCloneDialog()"
            ></p-button>
            <p-button
              icon="pi pi-send"
              [label]="'MASTER_COURSES.DETAIL.APPLY' | translate"
              severity="success"
              [disabled]="(linked()?.length || 0) === 0"
              (onClick)="openApplyDialog()"
            ></p-button>
          </div>
        }
      </div>

      @if (master()) {
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <p-card>
            <div class="text-sm text-gray-500">{{ 'MASTER_COURSES.DETAIL.DEFAULT_PRICE' | translate }}</div>
            <div class="text-2xl font-bold">{{ master()!.defaultPrice.toFixed(2) }}</div>
          </p-card>
          <p-card>
            <div class="text-sm text-gray-500">{{ 'MASTER_COURSES.DETAIL.DEFAULT_DURATION' | translate }}</div>
            <div class="text-2xl font-bold">
              {{ master()!.defaultDuration }} {{ 'MASTER_COURSES.WEEKS' | translate }}
            </div>
          </p-card>
          <p-card>
            <div class="text-sm text-gray-500">{{ 'MASTER_COURSES.DETAIL.DEFAULT_MAX_STUDENTS' | translate }}</div>
            <div class="text-2xl font-bold">
              {{ master()!.defaultMaxStudents ?? ('MASTER_COURSES.UNLIMITED' | translate) }}
            </div>
          </p-card>
        </div>

        @if (master()!.description) {
          <p-card styleClass="mb-6">
            <div class="text-sm text-gray-500 mb-2">{{ 'MASTER_COURSES.DETAIL.DESCRIPTION' | translate }}</div>
            <div class="text-gray-800 whitespace-pre-line">{{ master()!.description }}</div>
          </p-card>
        }
      }

      <p-card>
        <ng-template pTemplate="header">
          <div class="px-6 py-4 border-b flex justify-between items-center">
            <h3 class="text-xl font-semibold">
              {{ 'MASTER_COURSES.DETAIL.LINKED_COURSES' | translate }}
              <span class="text-sm font-normal text-gray-500 ml-2">
                ({{ linked()?.length || 0 }})
              </span>
            </h3>
          </div>
        </ng-template>

        <p-table [value]="linked() || []" [loading]="loadingLinked()" responsiveLayout="scroll">
          <ng-template pTemplate="header">
            <tr>
              <th>{{ 'MASTER_COURSES.DETAIL.COL_BRANCH' | translate }}</th>
              <th>{{ 'MASTER_COURSES.DETAIL.COL_NAME' | translate }}</th>
              <th>{{ 'MASTER_COURSES.DETAIL.COL_CODE' | translate }}</th>
              <th>{{ 'MASTER_COURSES.DETAIL.COL_PRICE' | translate }}</th>
              <th>{{ 'MASTER_COURSES.DETAIL.COL_DURATION' | translate }}</th>
              <th>{{ 'MASTER_COURSES.DETAIL.COL_STATUS' | translate }}</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.branchName }}</td>
              <td>{{ row.name }}</td>
              <td><span class="font-mono">{{ row.code }}</span></td>
              <td>{{ row.price.toFixed(2) }}</td>
              <td>{{ row.duration }} {{ 'MASTER_COURSES.WEEKS' | translate }}</td>
              <td>
                <p-tag
                  [value]="row.isActive ? ('MASTER_COURSES.ACTIVE' | translate) : ('MASTER_COURSES.INACTIVE' | translate)"
                  [severity]="row.isActive ? 'success' : 'danger'"
                ></p-tag>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="6" class="text-center py-6 text-gray-500">
                {{ 'MASTER_COURSES.DETAIL.NO_LINKED' | translate }}
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- Apply dialog -->
      <p-dialog
        [(visible)]="showApplyDialog"
        [modal]="true"
        [header]="'MASTER_COURSES.APPLY.TITLE' | translate"
        [style]="{ width: '480px' }"
      >
        <p class="text-gray-600 mb-4">
          {{ 'MASTER_COURSES.APPLY.DESC' | translate: { count: linked()?.length || 0 } }}
        </p>
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <p-checkbox [(ngModel)]="applyFlags.applyName" [binary]="true" inputId="an"></p-checkbox>
            <label for="an">{{ 'MASTER_COURSES.APPLY.NAME' | translate }}</label>
          </div>
          <div class="flex items-center gap-2">
            <p-checkbox [(ngModel)]="applyFlags.applyDescription" [binary]="true" inputId="ad"></p-checkbox>
            <label for="ad">{{ 'MASTER_COURSES.APPLY.DESCRIPTION' | translate }}</label>
          </div>
          <div class="flex items-center gap-2">
            <p-checkbox [(ngModel)]="applyFlags.applyPrice" [binary]="true" inputId="ap"></p-checkbox>
            <label for="ap">{{ 'MASTER_COURSES.APPLY.PRICE' | translate }}</label>
          </div>
          <div class="flex items-center gap-2">
            <p-checkbox [(ngModel)]="applyFlags.applyDuration" [binary]="true" inputId="adu"></p-checkbox>
            <label for="adu">{{ 'MASTER_COURSES.APPLY.DURATION' | translate }}</label>
          </div>
          <div class="flex items-center gap-2">
            <p-checkbox [(ngModel)]="applyFlags.applyMaxStudents" [binary]="true" inputId="ams"></p-checkbox>
            <label for="ams">{{ 'MASTER_COURSES.APPLY.MAX_STUDENTS' | translate }}</label>
          </div>
        </div>
        <ng-template pTemplate="footer">
          <p-button
            [label]="'MASTER_COURSES.APPLY.CANCEL' | translate"
            severity="secondary"
            [outlined]="true"
            (onClick)="showApplyDialog = false"
          ></p-button>
          <p-button
            [label]="'MASTER_COURSES.APPLY.CONFIRM' | translate"
            severity="success"
            [loading]="applying()"
            [disabled]="!anyApplyFlagSelected()"
            (onClick)="doApply()"
          ></p-button>
        </ng-template>
      </p-dialog>

      <!-- Clone dialog -->
      <p-dialog
        [(visible)]="showCloneDialog"
        [modal]="true"
        [header]="'MASTER_COURSES.CLONE.TITLE' | translate"
        [style]="{ width: '480px' }"
      >
        <p class="text-gray-600 mb-4">{{ 'MASTER_COURSES.CLONE.DESC' | translate }}</p>
        <div class="flex flex-col gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ 'MASTER_COURSES.CLONE.TARGET_BRANCH' | translate }} <span class="text-red-500">*</span>
            </label>
            <p-select
              [(ngModel)]="cloneBranchId"
              [options]="cloneTargetBranches()"
              optionLabel="name"
              optionValue="id"
              [placeholder]="'MASTER_COURSES.CLONE.SELECT_BRANCH' | translate"
              [style]="{ width: '100%' }"
              appendTo="body"
            ></p-select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ 'MASTER_COURSES.CLONE.CODE' | translate }}
            </label>
            <input pInputText [(ngModel)]="cloneCode" class="w-full" [placeholder]="master()?.code || ''" />
            <p class="text-xs text-gray-500 mt-1">{{ 'MASTER_COURSES.CLONE.CODE_HINT' | translate }}</p>
          </div>
        </div>
        <ng-template pTemplate="footer">
          <p-button
            [label]="'MASTER_COURSES.CLONE.CANCEL' | translate"
            severity="secondary"
            [outlined]="true"
            (onClick)="showCloneDialog = false"
          ></p-button>
          <p-button
            [label]="'MASTER_COURSES.CLONE.CONFIRM' | translate"
            severity="help"
            [loading]="cloning()"
            [disabled]="!cloneBranchId"
            (onClick)="doClone()"
          ></p-button>
        </ng-template>
      </p-dialog>
    </div>
  `,
})
export class MasterCourseDetailComponent implements OnInit {
  private service = inject(MasterCourseService);
  private branchService = inject(BranchService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  authService = inject(AuthService);

  id!: string;
  master = signal<MasterCourse | null>(null);
  linked = signal<LinkedCourseSummary[] | null>(null);
  branches = signal<Branch[]>([]);
  loadingLinked = signal(true);

  showApplyDialog = false;
  applying = signal(false);
  applyFlags = {
    applyName: false,
    applyDescription: false,
    applyPrice: true,
    applyDuration: false,
    applyMaxStudents: false,
  };

  instantiating = signal(false);

  showCloneDialog = false;
  cloning = signal(false);
  cloneBranchId: string | null = null;
  cloneCode = '';

  linkedBranchIds = computed(() => {
    const set = new Set<string>();
    (this.linked() || []).forEach((c) => c.branchId && set.add(c.branchId));
    return set;
  });

  alreadyInstantiated = computed(() => {
    const m = this.master();
    if (!m?.branchId) return true;
    return this.linkedBranchIds().has(m.branchId);
  });

  cloneTargetBranches = computed(() => {
    const srcId = this.master()?.branchId;
    return this.branches().filter((b) => b.id !== srcId);
  });

  ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id')!;
    this.loadMaster();
    this.loadLinked();
    this.loadBranches();
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

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (rows) => this.branches.set(rows),
    });
  }

  anyApplyFlagSelected(): boolean {
    return Object.values(this.applyFlags).some((v) => v);
  }

  openApplyDialog() { this.showApplyDialog = true; }

  doApply() {
    this.applying.set(true);
    this.service.apply(this.id, this.applyFlags).subscribe({
      next: (res) => {
        this.applying.set(false);
        this.showApplyDialog = false;
        this.notifications.success(
          `Applied to ${res.updatedCount} course(s)` +
          (res.skippedCount ? `, ${res.skippedCount} skipped` : '')
        );
        this.loadLinked();
      },
      error: (err) => {
        this.applying.set(false);
        this.notifications.error(err?.error?.message || 'Apply failed');
      },
    });
  }

  doInstantiate() {
    const m = this.master();
    if (!m?.branchId) {
      this.notifications.error('Master course has no branch assigned');
      return;
    }
    this.instantiating.set(true);
    this.service.instantiate(this.id, { branchIds: [m.branchId] }).subscribe({
      next: (res) => {
        this.instantiating.set(false);
        if (res.createdCount > 0) {
          this.notifications.success(`Created ${res.createdCount} course`);
        } else {
          this.notifications.error('Nothing was created — the course may already exist on this branch');
        }
        this.loadLinked();
      },
      error: (err) => {
        this.instantiating.set(false);
        this.notifications.error(err?.error?.message || 'Instantiate failed');
      },
    });
  }

  openCloneDialog() {
    this.cloneBranchId = null;
    this.cloneCode = '';
    this.showCloneDialog = true;
  }

  doClone() {
    if (!this.cloneBranchId) return;
    this.cloning.set(true);
    const payload = {
      branchId: this.cloneBranchId,
      code: this.cloneCode?.trim() || undefined,
    };
    this.service.clone(this.id, payload).subscribe({
      next: (row) => {
        this.cloning.set(false);
        this.showCloneDialog = false;
        this.notifications.success('Master course cloned');
        this.router.navigate(['/master-courses', row.id]);
      },
      error: (err) => {
        this.cloning.set(false);
        this.notifications.error(err?.error?.message || 'Clone failed');
      },
    });
  }

  edit() { this.router.navigate(['/master-courses', this.id, 'edit']); }
  back() { this.router.navigate(['/master-courses']); }
}
