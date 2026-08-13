import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
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
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { SchoolLevel } from '@shared/interfaces/school-level.interface';

/**
 * A SCHOOL tenant's "Educational Stages" — the grade/class-year ladder. A
 * near-duplicate of LevelListComponent, deliberately kept separate (own table,
 * own schema, own component): no age range here, and the two are expected to
 * diverge further once the real School feature set is designed.
 */
@Component({
  selector: 'app-school-level-list',
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
  templateUrl: './school-level-list.component.html',
})
export class SchoolLevelListComponent implements OnInit {
  private router = inject(Router);
  private levelService = inject(SchoolLevelService);
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  levels = signal<SchoolLevel[]>([]);
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
    this.loadLevels();
  }

  viewSubjects(level: SchoolLevel) {
    this.router.navigate(['/educational-stages', level.id]);
  }

  loadLevels() {
    this.loading.set(true);
    this.levelService.getAllLevels().subscribe({
      next: (levels) => {
        this.levels.set(levels);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error(this.translate.instant('SCHOOL_LEVELS.LIST.LOAD_ERROR'));
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

  openEdit(level: SchoolLevel) {
    this.isEditMode.set(true);
    this.editingId = level.id;
    this.form.reset({ name: level.name });
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
      this.loadLevels();
    };
    const fail = () => this.saving.set(false);

    if (this.isEditMode() && this.editingId) {
      this.levelService.updateLevel(this.editingId, value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('SCHOOL_LEVELS.FORM.UPDATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    } else {
      this.levelService.createLevel(value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('SCHOOL_LEVELS.FORM.CREATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    }
  }

  deleteLevel(level: SchoolLevel) {
    this.confirmationService.confirm({
      header: this.translate.instant('SCHOOL_LEVELS.LIST.DELETE_TITLE'),
      message: this.translate.instant('SCHOOL_LEVELS.LIST.DELETE_MSG', { name: level.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.levelService.deleteLevel(level.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('SCHOOL_LEVELS.LIST.DELETED'));
            this.loadLevels();
          },
        });
      },
    });
  }
}
