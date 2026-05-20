import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RoomService, Room, CreateRoomDto, UpdateRoomDto } from '../services/room.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-room-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TagModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    SelectModule,
    CheckboxModule,
    TooltipModule,
    TranslateModule,
  ],
  templateUrl: './room-list.component.html',
})
export class RoomListComponent implements OnInit {
  private roomService = inject(RoomService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private fb = inject(FormBuilder);

  rooms = signal<Room[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  saving = signal(false);
  editingRoom = signal<Room | null>(null);
  deletingRoom = signal<Room | null>(null);

  /** Currently selected branch id for filtering (null = show all) */
  selectedBranchId = signal<string | null>(null);

  showDialog = false;
  showDeleteDialog = false;
  roomForm: FormGroup = this.fb.group({
      code: ['', Validators.required],
      description: [''],
      branchId: ['', Validators.required],
    });;

  /** Branches list prefixed with an "All Branches" option for the filter dropdown */
  branchFilterOptions = computed(() => this.branches());

  /** Rooms filtered by the selected branch */
  filteredRooms = computed(() => {
    const all = this.rooms();
    const branchId = this.selectedBranchId();
    if (!branchId) return all;
    return all.filter(r => r.branchId === branchId);
  });

  occupiedCount = computed(() => this.filteredRooms().filter(r => r.isOccupied).length);
  freeCount = computed(() => this.filteredRooms().filter(r => !r.isOccupied && r.isActive).length);

  ngOnInit() {
    this.loadBranches();
    this.loadRooms();
  }

  loadBranches() {
    this.branchService.getAllBranches().subscribe({
      next: (b) => this.branches.set(b),
    });
  }

  loadRooms() {
    this.loading.set(true);
    this.roomService.list().subscribe({
      next: (rooms) => { this.rooms.set(rooms); this.loading.set(false); },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
      },
    });
  }

  onBranchFilterChange() {
    // Signal-based computed will re-evaluate automatically;
    // this handler exists for any future side-effects.
  }

  clearBranchFilter() {
    this.selectedBranchId.set(null);
  }

  openCreateDialog() {
    this.editingRoom.set(null);
    this.roomForm = this.fb.group({
      code: ['', Validators.required],
      description: [''],
      branchId: ['', Validators.required],
    });
    this.showDialog = true;
  }

  openEditDialog(room: Room) {
    this.editingRoom.set(room);
    this.roomForm = this.fb.group({
      code: [room.code, Validators.required],
      description: [room.description || ''],
      isActive: [room.isActive],
    });
    this.showDialog = true;
  }

  closeDialog() {
    this.showDialog = false;
    this.editingRoom.set(null);
  }

  saveRoom() {
    if (this.roomForm.invalid) { this.roomForm.markAllAsTouched(); return; }
    this.saving.set(true);
    const val = this.roomForm.value;
    const editing = this.editingRoom();

    if (editing) {
      const dto: UpdateRoomDto = { code: val.code, isActive: val.isActive };
      if (val.description !== undefined) dto.description = val.description || undefined;
      this.roomService.update(editing.id, dto).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeDialog();
          this.loadRooms();
          this.notificationService.success(this.translate.instant('ROOMS.UPDATED'));
        },
        error: () => {
          // Interceptor toasted the translated error.
          this.saving.set(false);
        },
      });
    } else {
      const dto: CreateRoomDto = { branchId: val.branchId, code: val.code };
      if (val.description) dto.description = val.description;
      this.roomService.create(dto).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeDialog();
          this.loadRooms();
          this.notificationService.success(this.translate.instant('ROOMS.CREATED'));
        },
        error: () => {
          // Interceptor toasted the translated error.
          this.saving.set(false);
        },
      });
    }
  }

  confirmDelete(room: Room) {
    this.deletingRoom.set(room);
    this.showDeleteDialog = true;
  }

  deleteRoom() {
    const room = this.deletingRoom();
    if (!room) return;
    this.saving.set(true);
    this.roomService.delete(room.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.showDeleteDialog = false;
        this.deletingRoom.set(null);
        this.loadRooms();
        this.notificationService.success(this.translate.instant('ROOMS.DELETED'));
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.saving.set(false);
      },
    });
  }

  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
}
