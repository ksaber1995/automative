import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { SubjectService } from '../services/subject.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { Subject } from '@shared/interfaces/subject.interface';

@Component({
  selector: 'app-subject-list',
  standalone: true,
  imports: [
    CommonModule,
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
  templateUrl: './subject-list.component.html',
})
export class SubjectListComponent implements OnInit {
  private subjectService = inject(SubjectService);
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  subjects = signal<Subject[]>([]);
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
    this.loadSubjects();
  }

  loadSubjects() {
    this.loading.set(true);
    this.subjectService.getAllSubjects().subscribe({
      next: (subjects) => {
        this.subjects.set(subjects);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error(this.translate.instant('SUBJECTS.LIST.LOAD_ERROR'));
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

  openEdit(subject: Subject) {
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
    const value = { name: this.form.value.name?.trim() };

    const done = () => {
      this.saving.set(false);
      this.closeDialog();
      this.loadSubjects();
    };
    const fail = () => this.saving.set(false);

    if (this.isEditMode() && this.editingId) {
      this.subjectService.updateSubject(this.editingId, value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('SUBJECTS.FORM.UPDATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    } else {
      this.subjectService.createSubject(value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('SUBJECTS.FORM.CREATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    }
  }

  deleteSubject(subject: Subject) {
    this.confirmationService.confirm({
      header: this.translate.instant('SUBJECTS.LIST.DELETE_TITLE'),
      message: this.translate.instant('SUBJECTS.LIST.DELETE_MSG', { name: subject.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.subjectService.deleteSubject(subject.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('SUBJECTS.LIST.DELETED'));
            this.loadSubjects();
          },
        });
      },
    });
  }
}
