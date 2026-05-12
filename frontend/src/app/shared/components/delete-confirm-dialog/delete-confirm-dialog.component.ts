import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-delete-confirm-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    ButtonModule,
    InputTextModule,
    TranslateModule
  ],
  templateUrl: './delete-confirm-dialog.component.html',
  styleUrl: './delete-confirm-dialog.component.scss'})
export class DeleteConfirmDialogComponent {
  @Input() header = 'Confirm Deletion';
  @Input() message = 'Are you sure you want to delete this item?';
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  confirmText = '';
  showError = signal(false);

  onConfirm() {
    if (this.confirmText === 'delete') {
      this.confirm.emit();
      this.resetAndClose();
    } else {
      this.showError.set(true);
    }
  }

  onCancel() {
    this.cancel.emit();
    this.resetAndClose();
  }

  private resetAndClose() {
    this.confirmText = '';
    this.showError.set(false);
    this.visible = false;
    this.visibleChange.emit(false);
  }
}
