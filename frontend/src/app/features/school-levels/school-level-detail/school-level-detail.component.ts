import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SchoolLevelService } from '../services/school-level.service';
import { SchoolSubjectService } from '../services/school-subject.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { SchoolLevel } from '@shared/interfaces/school-level.interface';
import { SchoolSubject } from '@shared/interfaces/school-subject.interface';

/**
 * One educational stage's own page: its name, and the subjects that live
 * inside it. Reached by navigating from the stage list ("view subjects").
 * The add/edit dialog here never shows a level picker — the stage is fixed
 * to whichever page you're on, unlike the flat Subjects page.
 */
@Component({
  selector: 'app-school-level-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TooltipModule,
    DialogModule,
    InputTextModule,
    ConfirmDialogModule,
    TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './school-level-detail.component.html',
})
export class SchoolLevelDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private levelService = inject(SchoolLevelService);
  private subjectService = inject(SchoolSubjectService);
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  levelId = '';
  level = signal<SchoolLevel | null>(null);
  subjects = signal<SchoolSubject[]>([]);
  loading = signal(true);
  saving = signal(false);
  showDialog = signal(false);
  isEditMode = signal(false);
  editingId: string | null = null;

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
  });

  get name() { return this.form.get('name'); }

  ngOnInit() {
    this.levelId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.levelId) {
      this.router.navigate(['/educational-stages']);
      return;
    }
    this.loadLevel();
    this.loadSubjects();
  }

  loadLevel() {
    this.levelService.getLevelById(this.levelId).subscribe({
      next: (level) => this.level.set(level),
      error: () => this.router.navigate(['/educational-stages']),
    });
  }

  loadSubjects() {
    this.loading.set(true);
    this.subjectService.getAllSubjects(this.levelId).subscribe({
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
    this.form.reset({ name: '' });
    this.showDialog.set(true);
  }

  openEdit(subject: SchoolSubject) {
    this.isEditMode.set(true);
    this.editingId = subject.id;
    this.form.reset({ name: subject.name });
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
    const name = this.form.value.name?.trim();

    const done = () => {
      this.saving.set(false);
      this.closeDialog();
      this.loadSubjects();
    };
    const fail = () => this.saving.set(false);

    if (this.isEditMode() && this.editingId) {
      this.subjectService.updateSubject(this.editingId, { name }).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('SCHOOL_SUBJECTS.FORM.UPDATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    } else {
      this.subjectService.createSubject({ name, levelId: this.levelId }).subscribe({
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
