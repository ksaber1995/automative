import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TranslateModule } from '@ngx-translate/core';
import { MasterCourseService } from '../services/master-course.service';
import { BranchService } from '../../branches/services/branch.service';
import { LevelService } from '../../levels/services/level.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';
import { Level } from '@shared/interfaces/level.interface';

@Component({
  selector: 'app-master-course-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    SelectModule,
    TranslateModule,
  ],
  templateUrl: './master-course-form.component.html',
})
export class MasterCourseFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private service = inject(MasterCourseService);
  private branchService = inject(BranchService);
  private levelService = inject(LevelService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notifications = inject(NotificationService);

  form: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  branches = signal<Branch[]>([]);
  levels = signal<Level[]>([]);
  id: string | null = null;

  constructor() {
    this.form = this.fb.group({
      branchId: [null, Validators.required],
      name: ['', [Validators.required, Validators.minLength(3)]],
      code: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      defaultPrice: [0, [Validators.required, Validators.min(0)]],
      defaultDuration: [8, [Validators.required, Validators.min(1), Validators.max(52)]],
      defaultMaxStudents: [null],
      levelId: [null],
    });
  }

  ngOnInit() {
    this.branchService.getActiveBranches().subscribe({
      next: (rows) => this.branches.set(rows),
    });
    this.levelService.getAllLevels().subscribe({
      next: (rows) => this.levels.set(rows),
    });
    this.id = this.route.snapshot.paramMap.get('id');
    if (this.id) {
      this.isEditMode.set(true);
      this.load(this.id);
    }
  }

  load(id: string) {
    this.loading.set(true);
    this.service.getById(id).subscribe({
      next: (row) => {
        this.form.patchValue({
          branchId: row.branchId,
          name: row.name,
          code: row.code,
          description: row.description || '',
          defaultPrice: row.defaultPrice,
          defaultDuration: row.defaultDuration,
          defaultMaxStudents: row.defaultMaxStudents,
          levelId: row.levelId || null,
        });
        this.form.get('branchId')?.disable();
        this.loading.set(false);
      },
      error: () => {
        this.notifications.error('Failed to load master course');
        this.loading.set(false);
        this.router.navigate(['/master-courses']);
      },
    });
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.loading.set(true);
    if (this.isEditMode() && this.id) {
      const updatePayload = {
        name: v.name,
        code: v.code,
        description: v.description?.trim() || undefined,
        defaultPrice: v.defaultPrice,
        defaultDuration: v.defaultDuration,
        defaultMaxStudents: v.defaultMaxStudents || undefined,
        levelId: v.levelId || null,
      };
      this.service.update(this.id, updatePayload).subscribe({
        next: () => {
          this.notifications.success('Master course updated');
          this.router.navigate(['/master-courses']);
        },
        error: (err) => {
          this.loading.set(false);
          this.notifications.error(err?.error?.message || 'Update failed');
        },
      });
    } else {
      const createPayload = {
        branchId: v.branchId,
        name: v.name,
        code: v.code,
        description: v.description?.trim() || undefined,
        defaultPrice: v.defaultPrice,
        defaultDuration: v.defaultDuration,
        defaultMaxStudents: v.defaultMaxStudents || undefined,
        levelId: v.levelId || null,
      };
      this.service.create(createPayload).subscribe({
        next: () => {
          this.notifications.success('Master course created');
          this.router.navigate(['/master-courses']);
        },
        error: (err) => {
          this.loading.set(false);
          this.notifications.error(err?.error?.message || 'Create failed');
        },
      });
    }
  }

  cancel() { this.router.navigate(['/master-courses']); }
}
