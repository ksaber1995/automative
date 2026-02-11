import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'app-delete-confirm-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    ButtonModule,
    InputTextModule
  ],
  template: `
    <p-dialog
      [header]="header"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '450px' }"
      [draggable]="false"
      [resizable]="false"
      (onHide)="onCancel()"
    >
      <div class="flex flex-col gap-4">
        <div class="flex items-start gap-3">
          <i class="pi pi-exclamation-triangle text-4xl text-red-500"></i>
          <div class="flex-1">
            <p class="text-gray-700 mb-2">{{ message }}</p>
            <p class="text-sm text-gray-600 mb-4">
              This action cannot be undone. Please type <strong class="text-red-600">delete</strong> to confirm.
            </p>
            <input
              pInputText
              type="text"
              [(ngModel)]="confirmText"
              placeholder="Type 'delete' to confirm"
              class="w-full"
              [class.border-red-500]="showError()"
              (keyup.enter)="onConfirm()"
            />
            @if (showError()) {
              <small class="text-red-500 mt-1 block">
                Please type "delete" to confirm
              </small>
            }
          </div>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <div class="flex justify-end gap-2">
          <p-button
            label="Cancel"
            severity="secondary"
            (onClick)="onCancel()"
            [outlined]="true"
          ></p-button>
          <p-button
            label="Delete"
            severity="danger"
            (onClick)="onConfirm()"
            [disabled]="confirmText !== 'delete'"
          ></p-button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    :host ::ng-deep .p-dialog-header {
      background-color: #fee;
      border-bottom: 1px solid #fcc;
    }
  `]
})
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
