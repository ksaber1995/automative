import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RoomService, Room } from '../../../services/room.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-rooms-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule],
  templateUrl: './rooms-list.component.html',
})
export class RoomsListComponent implements OnInit {
  rooms: Room[] = [];
  loading = true;
  saving = false;
  showModal = false;
  showDeleteModal = false;
  editingRoom: Room | null = null;
  deletingRoom: Room | null = null;
  branches: { id: string; name: string }[] = [];
  roomForm!: FormGroup;

  get occupiedCount() { return this.rooms.filter(r => r.isOccupied).length; }
  get freeCount() { return this.rooms.filter(r => !r.isOccupied && r.isActive).length; }

  constructor(
    private roomService: RoomService,
    private authService: AuthService,
    private fb: FormBuilder,
  ) {}

  ngOnInit() {
    this.loadBranches();
    this.loadRooms();
  }

  loadBranches() {
    const user = this.authService.currentUser;
    if (user?.['branches']) {
      this.branches = user['branches'];
    }
  }

  loadRooms() {
    this.loading = true;
    this.roomService.list().subscribe({
      next: (rooms) => { this.rooms = rooms; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  openCreateModal() {
    this.editingRoom = null;
    this.roomForm = this.fb.group({
      code: ['', Validators.required],
      description: [''],
      branchId: ['', Validators.required],
    });
    this.showModal = true;
  }

  openEditModal(room: Room) {
    this.editingRoom = room;
    this.roomForm = this.fb.group({
      code: [room.code, Validators.required],
      description: [room.description || ''],
      isActive: [room.isActive],
    });
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
    this.editingRoom = null;
  }

  saveRoom() {
    if (this.roomForm.invalid) return;
    this.saving = true;
    const val = this.roomForm.value;

    if (this.editingRoom) {
      this.roomService.update(this.editingRoom.id, { code: val.code, description: val.description || undefined, isActive: val.isActive }).subscribe({
        next: () => { this.saving = false; this.closeModal(); this.loadRooms(); },
        error: () => { this.saving = false; },
      });
    } else {
      this.roomService.create({ branchId: val.branchId, code: val.code, description: val.description || undefined }).subscribe({
        next: () => { this.saving = false; this.closeModal(); this.loadRooms(); },
        error: () => { this.saving = false; },
      });
    }
  }

  confirmDelete(room: Room) {
    this.deletingRoom = room;
    this.showDeleteModal = true;
  }

  deleteRoom() {
    if (!this.deletingRoom) return;
    this.saving = true;
    this.roomService.delete(this.deletingRoom.id).subscribe({
      next: () => { this.saving = false; this.showDeleteModal = false; this.deletingRoom = null; this.loadRooms(); },
      error: () => { this.saving = false; },
    });
  }
}
