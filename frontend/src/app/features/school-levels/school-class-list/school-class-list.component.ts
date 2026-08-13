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
import { SchoolClassService } from '../services/school-class.service';
import { SchoolLevelService } from '../services/school-level.service';
import { RoomService, Room } from '../../rooms/services/room.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { SchoolClass } from '@shared/interfaces/school-class.interface';
import { SchoolLevel } from '@shared/interfaces/school-level.interface';

/**
 * A SCHOOL tenant's classes — the flat view across every educational stage,
 * with a Level filter. Unlike the academy Classes page, there is no course
 * and no timetable here: just a name, a stage (required), and an optional
 * room picked from the company's existing rooms.
 */
@Component({
  selector: 'app-school-class-list',
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
  templateUrl: './school-class-list.component.html',
})
export class SchoolClassListComponent implements OnInit {
  private classService = inject(SchoolClassService);
  private levelService = inject(SchoolLevelService);
  private roomService = inject(RoomService);
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  classes = signal<SchoolClass[]>([]);
  levels = signal<SchoolLevel[]>([]);
  rooms = signal<Room[]>([]);
  loading = signal(true);
  saving = signal(false);
  showDialog = signal(false);
  isEditMode = signal(false);
  editingId: string | null = null;

  /** Level filter for the table — null means every stage. */
  levelFilter = signal<string | null>(null);

  filteredClasses = computed(() => {
    const filter = this.levelFilter();
    const list = this.classes();
    return filter ? list.filter((c) => c.levelId === filter) : list;
  });

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    levelId: [null as string | null, Validators.required],
    roomId: [null as string | null],
  });

  get name() { return this.form.get('name'); }
  get levelId() { return this.form.get('levelId'); }

  ngOnInit() {
    this.loadLevels();
    this.loadRooms();
    this.loadClasses();
  }

  loadLevels() {
    this.levelService.getAllLevels().subscribe({
      next: (levels) => this.levels.set(levels),
    });
  }

  loadRooms() {
    // Every room the company has, across branches — a school class isn't
    // scoped to one branch the way academy rooms usually are picked.
    this.roomService.list().subscribe({
      next: (rooms) => this.rooms.set(rooms),
    });
  }

  loadClasses() {
    this.loading.set(true);
    // Loaded unfiltered; the level filter above narrows client-side so
    // switching it is instant, no re-fetch.
    this.classService.getAllClasses().subscribe({
      next: (classes) => {
        this.classes.set(classes);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error(this.translate.instant('SCHOOL_CLASSES.LIST.LOAD_ERROR'));
        this.loading.set(false);
      },
    });
  }

  openCreate() {
    this.isEditMode.set(false);
    this.editingId = null;
    this.form.reset({ name: '', levelId: this.levelFilter() || null, roomId: null });
    this.showDialog.set(true);
  }

  openEdit(cls: SchoolClass) {
    this.isEditMode.set(true);
    this.editingId = cls.id;
    this.form.reset({ name: cls.name, levelId: cls.levelId, roomId: cls.roomId });
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
      roomId: this.form.value.roomId || null,
    };

    const done = () => {
      this.saving.set(false);
      this.closeDialog();
      this.loadClasses();
    };
    const fail = () => this.saving.set(false);

    if (this.isEditMode() && this.editingId) {
      this.classService.updateClass(this.editingId, value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('SCHOOL_CLASSES.FORM.UPDATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    } else {
      this.classService.createClass(value).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('SCHOOL_CLASSES.FORM.CREATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    }
  }

  deleteClass(cls: SchoolClass) {
    this.confirmationService.confirm({
      header: this.translate.instant('SCHOOL_CLASSES.LIST.DELETE_TITLE'),
      message: this.translate.instant('SCHOOL_CLASSES.LIST.DELETE_MSG', { name: cls.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.classService.deleteClass(cls.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('SCHOOL_CLASSES.LIST.DELETED'));
            this.loadClasses();
          },
        });
      },
    });
  }
}
