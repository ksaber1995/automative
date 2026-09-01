import { TablePageUxDirective } from '../../../core/directives/table-page-ux.directive';
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LevelService } from '../services/level.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { Level } from '@shared/interfaces/level.interface';

// "To" age must be strictly greater than "From" when both are filled in.
function ageRangeValidator(group: AbstractControl): ValidationErrors | null {
  const from = group.get('fromAge')?.value;
  const to = group.get('toAge')?.value;
  if (from !== null && from !== undefined && to !== null && to !== undefined && to <= from) {
    return { ageRange: true };
  }
  return null;
}

@Component({
  selector: 'app-level-list',
  standalone: true,
  imports: [
    TablePageUxDirective,
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TooltipModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    ConfirmDialogModule,
    TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './level-list.component.html',
})
export class LevelListComponent implements OnInit {
  private levelService = inject(LevelService);
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  levels = signal<Level[]>([]);
  loading = signal(true);
  saving = signal(false);
  showDialog = signal(false);
  isEditMode = signal(false);
  editingId: string | null = null;

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    fromAge: [null as number | null],
    toAge: [null as number | null],
  }, { validators: ageRangeValidator });

  get name() { return this.form.get('name'); }
  get rangeInvalid() { return this.form.errors?.['ageRange'] && this.form.get('toAge')?.touched; }

  // Format a level's age range for the list, falling back to the legacy single age.
  ageDisplay(level: Level): string {
    const from = level.fromAge ?? null;
    const to = level.toAge ?? null;
    if (from !== null && to !== null) return `${from} - ${to}`;
    if (from !== null) return `${from}+`;
    if (to !== null) return `≤ ${to}`;
    if (level.age !== null && level.age !== undefined) return `${level.age}`;
    // No age set — show nothing rather than a placeholder.
    return '';
  }

  ngOnInit() {
    this.loadLevels();
  }

  loadLevels() {
    this.loading.set(true);
    this.levelService.getAllLevels().subscribe({
      next: (levels) => {
        this.levels.set(levels);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error(this.translate.instant('LEVELS.LIST.LOAD_ERROR'));
        this.loading.set(false);
      },
    });
  }

  openCreate() {
    this.isEditMode.set(false);
    this.editingId = null;
    this.form.reset({ name: '', fromAge: null, toAge: null });
    this.showDialog.set(true);
  }

  openEdit(level: Level) {
    this.isEditMode.set(true);
    this.editingId = level.id;
    this.form.reset({ name: level.name, fromAge: level.fromAge ?? null, toAge: level.toAge ?? null });
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
      fromAge: this.form.value.fromAge ?? null,
      toAge: this.form.value.toAge ?? null,
    };

    const done = () => {
      this.saving.set(false);
      this.closeDialog();
      this.loadLevels();
    };
    const fail = () => this.saving.set(false);

    if (this.isEditMode() && this.editingId) {
      this.levelService.updateLevel(this.editingId, value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('LEVELS.FORM.UPDATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    } else {
      this.levelService.createLevel(value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('LEVELS.FORM.CREATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    }
  }

  deleteLevel(level: Level) {
    this.confirmationService.confirm({
      header: this.translate.instant('LEVELS.LIST.DELETE_TITLE'),
      message: this.translate.instant('LEVELS.LIST.DELETE_MSG', { name: level.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.levelService.deleteLevel(level.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('LEVELS.LIST.DELETED'));
            this.loadLevels();
          },
        });
      },
    });
  }
}
