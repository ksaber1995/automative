import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SchoolSemesterService } from '../services/school-semester.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { SchoolSemester } from '@shared/interfaces/school-semester.interface';

function toYmd(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromYmd(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** A SCHOOL tenant's semesters/terms — company-wide, no relation to
 *  educational stages or subjects. Minimal CRUD, expected to grow once the
 *  real School feature set is designed. */
@Component({
  selector: 'app-school-semester-list',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TooltipModule,
    TagModule,
    DialogModule,
    InputTextModule,
    DatePickerModule,
    CheckboxModule,
    ConfirmDialogModule,
    TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './school-semester-list.component.html',
})
export class SchoolSemesterListComponent implements OnInit {
  private semesterService = inject(SchoolSemesterService);
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  semesters = signal<SchoolSemester[]>([]);
  loading = signal(true);
  saving = signal(false);
  showDialog = signal(false);
  isEditMode = signal(false);
  editingId: string | null = null;

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    startDate: [null as Date | null],
    endDate: [null as Date | null],
    isActive: [true],
  });

  get name() { return this.form.get('name'); }

  ngOnInit() {
    this.loadSemesters();
  }

  loadSemesters() {
    this.loading.set(true);
    this.semesterService.getAllSemesters().subscribe({
      next: (semesters) => {
        this.semesters.set(semesters);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error(this.translate.instant('SCHOOL_SEMESTERS.LIST.LOAD_ERROR'));
        this.loading.set(false);
      },
    });
  }

  openCreate() {
    this.isEditMode.set(false);
    this.editingId = null;
    this.form.reset({ name: '', startDate: null, endDate: null, isActive: true });
    this.showDialog.set(true);
  }

  openEdit(semester: SchoolSemester) {
    this.isEditMode.set(true);
    this.editingId = semester.id;
    this.form.reset({
      name: semester.name,
      startDate: fromYmd(semester.startDate),
      endDate: fromYmd(semester.endDate),
      isActive: semester.isActive,
    });
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
      startDate: toYmd(this.form.value.startDate),
      endDate: toYmd(this.form.value.endDate),
      isActive: this.form.value.isActive !== false,
    };

    const done = () => {
      this.saving.set(false);
      this.closeDialog();
      this.loadSemesters();
    };
    const fail = () => this.saving.set(false);

    if (this.isEditMode() && this.editingId) {
      this.semesterService.updateSemester(this.editingId, value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('SCHOOL_SEMESTERS.FORM.UPDATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    } else {
      this.semesterService.createSemester(value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('SCHOOL_SEMESTERS.FORM.CREATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    }
  }

  deleteSemester(semester: SchoolSemester) {
    this.confirmationService.confirm({
      header: this.translate.instant('SCHOOL_SEMESTERS.LIST.DELETE_TITLE'),
      message: this.translate.instant('SCHOOL_SEMESTERS.LIST.DELETE_MSG', { name: semester.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.semesterService.deleteSemester(semester.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('SCHOOL_SEMESTERS.LIST.DELETED'));
            this.loadSemesters();
          },
        });
      },
    });
  }
}
