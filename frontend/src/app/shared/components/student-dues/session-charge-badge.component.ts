import { Component, EventEmitter, Input, Output, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { AmountPipe } from '../../pipes/amount.pipe';
import { SessionPaymentsService } from '../../../features/session-payments/session-payments.service';

export interface SessionChargeInfo {
  id: string;
  /** PENDING | PAID | COVERED | WAIVED | REFUNDED */
  status: string;
  amountDue: number;
  amountPaid: number;
}

/**
 * The per-session charge strip under a student on a PER_SESSION class's
 * attendance roster — paid/partial/unpaid at a glance, with a one-click
 * confirm, an inline amount edit, and a void. Renders nothing when `charge`
 * is null: not a PER_SESSION course, or no charge exists yet for this session.
 *
 * Void and edit both go through the existing session-payments endpoints —
 * void resets the charge to unpaid/PENDING and wipes its money-ledger detail
 * (see voidPayment), so nothing about the voided amount lingers on screen or
 * in the revenue ledger. Edit is void-then-pay: it composes the same two
 * calls rather than needing a third endpoint.
 */
@Component({
  selector: 'app-session-charge-badge',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, TooltipModule, TranslateModule, AmountPipe],
  template: `
    @if (charge) {
      @if (charge.status === 'COVERED') {
        <div class="mt-2 flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-blue-700">
          <i class="pi pi-shield text-xs"></i>
          <span class="text-[11px] font-semibold">{{ 'SESSION_ATTENDANCE.CHARGE_COVERED' | translate }}</span>
        </div>
      } @else if (charge.status === 'WAIVED' || charge.status === 'REFUNDED') {
        <div class="mt-2 flex items-center gap-2 rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1.5 text-gray-600">
          <i class="pi pi-info-circle text-xs"></i>
          <span class="text-[11px] font-semibold">{{ ('SESSION_ATTENDANCE.CHARGE_' + charge.status) | translate }}</span>
        </div>
      } @else if (editing()) {
        <div class="mt-2 rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1.5">
          <div class="flex items-center gap-2">
            <input
              type="number"
              min="0"
              [max]="charge.amountDue"
              step="0.01"
              class="w-24 border rounded px-2 py-1 text-xs"
              [class.border-red-400]="editAmountTooHigh()"
              [class.border-indigo-200]="!editAmountTooHigh()"
              [ngModel]="editAmount()"
              (ngModelChange)="editAmount.set($event)"
            />
            <span class="text-[11px] text-gray-500">/ {{ charge.amountDue | amount }}</span>
            <p-button icon="pi pi-check" size="small" severity="success" [rounded]="true" [text]="true"
              [disabled]="editAmountTooHigh()" [loading]="busy()"
              [pTooltip]="'SESSION_ATTENDANCE.CHARGE_SAVE' | translate" (onClick)="saveEdit()"></p-button>
            <p-button icon="pi pi-times" size="small" severity="secondary" [rounded]="true" [text]="true"
              [disabled]="busy()" [pTooltip]="'SESSION_ATTENDANCE.CHARGE_CANCEL' | translate" (onClick)="cancelEdit()"></p-button>
          </div>
          <!-- A session bill is a fixed fee — this can never exceed it. -->
          @if (editAmountTooHigh()) {
            <div class="text-[11px] text-red-600 mt-1">{{ 'SESSION_ATTENDANCE.CHARGE_EXCEEDS_DUE' | translate }}</div>
          }
        </div>
      } @else if (charge.status === 'PAID' || (charge.amountPaid || 0) > 0) {
        <div class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-300 bg-green-50 px-2.5 py-1.5">
          <div class="flex items-center gap-2 text-green-700">
            <i class="pi pi-check-circle text-xs"></i>
            <span class="text-[11px] font-semibold">
              @if (charge.status === 'PAID') {
                {{ 'SESSION_ATTENDANCE.CHARGE_PAID' | translate }} {{ charge.amountPaid | amount }}
              } @else {
                {{ 'SESSION_ATTENDANCE.CHARGE_PARTIAL' | translate }} {{ charge.amountPaid | amount }} / {{ charge.amountDue | amount }}
              }
            </span>
          </div>
          <div class="flex items-center gap-1">
            <p-button icon="pi pi-pencil" [text]="true" [rounded]="true" size="small"
              [pTooltip]="'SESSION_ATTENDANCE.CHARGE_EDIT' | translate" (onClick)="startEdit()"></p-button>
            <!-- Labelled, not icon-only: this reverses only the PAYMENT, leaving
                 the student's attendance for this session exactly as checked. -->
            <p-button [label]="'SESSION_ATTENDANCE.CHARGE_VOID' | translate" icon="pi pi-undo" size="small"
              [outlined]="true" severity="warn" [loading]="busy()"
              [pTooltip]="'SESSION_ATTENDANCE.CHARGE_VOID_HINT' | translate" (onClick)="voidCharge()"></p-button>
          </div>
        </div>
      } @else {
        <div class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1.5">
          <div class="flex items-center gap-2 text-gray-600">
            <i class="pi pi-clock text-xs"></i>
            <span class="text-[11px] font-semibold">{{ 'SESSION_ATTENDANCE.CHARGE_UNPAID' | translate }} {{ charge.amountDue | amount }}</span>
          </div>
          <div class="flex items-center gap-1">
            <p-button [label]="'SESSION_ATTENDANCE.CHARGE_CONFIRM' | translate" icon="pi pi-wallet" size="small"
              severity="success" [loading]="busy()" (onClick)="confirmPaid()"></p-button>
            <p-button icon="pi pi-pencil" [text]="true" [rounded]="true" size="small"
              [pTooltip]="'SESSION_ATTENDANCE.CHARGE_EDIT' | translate" (onClick)="startEdit()"></p-button>
          </div>
        </div>
      }
    }
  `,
})
export class SessionChargeBadgeComponent {
  private sessionPayments = inject(SessionPaymentsService);

  /** Null: not a PER_SESSION course, or no charge exists yet for this session. */
  @Input() charge: SessionChargeInfo | null = null;
  /** Something changed server-side — the host should reload the roster. */
  @Output() changed = new EventEmitter<void>();

  busy = signal(false);
  editing = signal(false);
  editAmount = signal<number>(0);
  /** A session bill is a fixed fee — the edit can never book more than that. */
  editAmountTooHigh = computed(() => Number(this.editAmount()) > (this.charge?.amountDue ?? 0) + 0.009);

  /** Today as YYYY-MM-DD in the browser's own timezone. */
  private today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  confirmPaid(): void {
    if (!this.charge || this.busy()) return;
    const remaining = Math.max(0, this.charge.amountDue - (this.charge.amountPaid || 0));
    if (remaining <= 0) return;
    this.busy.set(true);
    this.sessionPayments.recordPayment(this.charge.id, { amount: remaining, paymentDate: this.today() }).subscribe({
      next: () => { this.busy.set(false); this.changed.emit(); },
      error: () => this.busy.set(false),
    });
  }

  startEdit(): void {
    if (!this.charge) return;
    this.editAmount.set(this.charge.amountPaid || 0);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  /**
   * Sets amount_paid to an EXACT new figure: void first (resets to 0/PENDING,
   * no ledger trail left behind), then pay the new amount if it's above zero.
   * Composes two existing endpoints rather than needing a third.
   */
  saveEdit(): void {
    if (!this.charge || this.busy() || this.editAmountTooHigh()) return;
    const id = this.charge.id;
    const amount = Math.min(this.charge.amountDue, Math.max(0, Number(this.editAmount()) || 0));
    this.busy.set(true);
    this.sessionPayments.voidPayment(id).subscribe({
      next: () => {
        if (amount > 0) {
          this.sessionPayments.recordPayment(id, { amount, paymentDate: this.today() }).subscribe({
            next: () => { this.busy.set(false); this.editing.set(false); this.changed.emit(); },
            error: () => { this.busy.set(false); },
          });
        } else {
          this.busy.set(false);
          this.editing.set(false);
          this.changed.emit();
        }
      },
      error: () => this.busy.set(false),
    });
  }

  voidCharge(): void {
    if (!this.charge || this.busy()) return;
    this.busy.set(true);
    this.sessionPayments.voidPayment(this.charge.id).subscribe({
      next: () => { this.busy.set(false); this.changed.emit(); },
      error: () => this.busy.set(false),
    });
  }
}
