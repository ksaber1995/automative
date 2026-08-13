import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SchoolSubjectService } from '../services/school-subject.service';
import { SchoolLevelService } from '../services/school-level.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { SchoolSubject } from '@shared/interfaces/school-subject.interface';
import { SchoolLevel } from '@shared/interfaces/school-level.interface';

/**
 * The flat view of every subject across every educational stage — the SCHOOL
 * counterpart of the academy Subjects page. Unlike that one, every subject
 * here belongs to a stage, so this page adds a Level filter and the
 * create/edit dialog always requires picking one.
 */
@Component({
  selector: 'app-school-subject-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TooltipModule,
    DialogModule,
    InputTextModule,
    SelectModule,
    ConfirmDialogModule,
    TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './school-subject-list.component.html',
})
export class SchoolSubjectListComponent implements OnInit {
  private subjectService = inject(SchoolSubjectService);
  private levelService = inject(SchoolLevelService);
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  subjects = signal<SchoolSubject[]>([]);
  levels = signal<SchoolLevel[]>([]);
  loading = signal(true);
  saving = signal(false);
  showDialog = signal(false);
  isEditMode = signal(false);
  editingId: string | null = null;

  /** Level filter for the table — null/'' means every stage. */
  levelFilter = signal<string | null>(null);

  filteredSubjects = computed(() => {
    const filter = this.levelFilter();
    const list = this.subjects();
    return filter ? list.filter((s) => s.levelId === filter) : list;
  });

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    levelId: [null as string | null, Validators.required],
  });

  get name() { return this.form.get('name'); }
  get levelId() { return this.form.get('levelId'); }

  ngOnInit() {
    this.loadLevels();
    this.loadSubjects();
  }

  loadLevels() {
    this.levelService.getAllLevels().subscribe({
      next: (levels) => this.levels.set(levels),
    });
  }

  loadSubjects() {
    this.loading.set(true);
    // Loaded unfiltered; the level filter above narrows client-side so
    // switching it is instant, no re-fetch.
    this.subjectService.getAllSubjects().subscribe({
      next: (subjects) => {
        this.subjects.set(subjects);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error(this.translate.instant('SCHOOL_SUBJECTS.LIST.LOAD_ERROR'));
        this.loading.set(false);
      },
    });
  }

  openCreate() {
    this.isEditMode.set(false);
    this.editingId = null;
    this.form.reset({ name: '', levelId: this.levelFilter() || null });
    this.showDialog.set(true);
  }

  openEdit(subject: SchoolSubject) {
    this.isEditMode.set(true);
    this.editingId = subject.id;
    this.form.reset({ name: subject.name, levelId: subject.levelId });
    this.showDialog.set(true);
  }

  closeDialog() {
    this.showDialog.set(false);
    this.editingId = null;
  }

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const value = {
      name: this.form.value.name?.trim(),
      levelId: this.form.value.levelId,
    };

    const done = () => {
      this.saving.set(false);
      this.closeDialog();
      this.loadSubjects();
    };
    const fail = () => this.saving.set(false);

    if (this.isEditMode() && this.editingId) {
      this.subjectService.updateSubject(this.editingId, value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('SCHOOL_SUBJECTS.FORM.UPDATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    } else {
      this.subjectService.createSubject(value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('SCHOOL_SUBJECTS.FORM.CREATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    }
  }

  deleteSubject(subject: SchoolSubject) {
    this.confirmationService.confirm({
      header: this.translate.instant('SCHOOL_SUBJECTS.LIST.DELETE_TITLE'),
      message: this.translate.instant('SCHOOL_SUBJECTS.LIST.DELETE_MSG', { name: subject.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.subjectService.deleteSubject(subject.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('SCHOOL_SUBJECTS.LIST.DELETED'));
            this.loadSubjects();
          },
        });
      },
    });
  }
}
