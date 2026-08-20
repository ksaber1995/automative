import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface BookingRow {
  id: string;
  courseId: string;
  courseName: string | null;
  classId: string | null;
  className: string | null;
  studentName: string;
  phone: string;
  parentPhone: string | null;
  notes: string | null;
  claimedAmount: number | null;
  hasPaymentPhoto: boolean;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  studentId: string | null;
  enrollmentId: string | null;
  createdAt: string;
}

/**
 * The online-booking approval queue. Accepting a request creates the student
 * AND the enrollment (with the confirmed money) through the same paths the
 * office uses by hand — see bookingsRoutes.accept.
 */
@Component({
  selector: 'app-bookings-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TagModule,
    DialogModule, InputNumberModule, SelectButtonModule, TooltipModule, ConfirmDialogModule, TranslateModule,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="container-custom py-8">
      <div class="flex flex-wrap justify-between items-start gap-4 mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">{{ 'BOOKINGS.TITLE' | translate }}</h1>
          <p class="text-gray-600 mt-1">{{ 'BOOKINGS.SUBTITLE' | translate }}</p>
        </div>
      </div>

      <!-- The tenant's shareable link -->
      <p-card styleClass="mb-6">
        <div class="flex flex-wrap items-center gap-3">
          <i class="pi pi-link text-blue-500"></i>
          <span class="font-medium">{{ 'BOOKINGS.LINK_LABEL' | translate }}</span>
          @if (link()) {
            <code class="bg-gray-100 rounded px-2 py-1 text-sm break-all" dir="ltr">{{ link() }}</code>
            <p-button size="small" [text]="true" [icon]="copied() ? 'pi pi-check' : 'pi pi-copy'"
              [label]="(copied() ? 'BOOKINGS.COPIED' : 'BOOKINGS.COPY') | translate" (onClick)="copyLink()"></p-button>
          } @else {
            <i class="pi pi-spin pi-spinner text-gray-400"></i>
          }
        </div>
      </p-card>

      <p-card>
        <div class="flex justify-between items-center flex-wrap gap-3 mb-4">
          <p-selectbutton [options]="statusOptions" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event); load()"
            optionLabel="label" optionValue="value"></p-selectbutton>
          <p-button icon="pi pi-refresh" [text]="true" (onClick)="load()"></p-button>
        </div>

        <p-table [value]="bookings()" [loading]="loading()" responsiveLayout="scroll"
          [paginator]="true" [rows]="20">
          <ng-template pTemplate="header">
            <tr>
              <th>{{ 'BOOKINGS.COL_STUDENT' | translate }}</th>
              <th>{{ 'BOOKINGS.COL_PHONE' | translate }}</th>
              <th>{{ 'BOOKINGS.COL_COURSE' | translate }}</th>
              <th class="text-center">{{ 'BOOKINGS.COL_AMOUNT' | translate }}</th>
              <th>{{ 'BOOKINGS.COL_DATE' | translate }}</th>
              <th>{{ 'BOOKINGS.COL_STATUS' | translate }}</th>
              <th style="width: 170px;"></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-b>
            <tr>
              <td>
                <div class="font-medium">{{ b.studentName }}</div>
                @if (b.notes) { <div class="text-xs text-gray-500 mt-0.5">{{ b.notes }}</div> }
              </td>
              <td dir="ltr">
                {{ b.phone }}
                @if (b.parentPhone) { <div class="text-xs text-gray-500">{{ b.parentPhone }}</div> }
              </td>
              <td>
                {{ b.courseName }}
                @if (b.className) { <div class="text-xs text-gray-500">{{ b.className }}</div> }
              </td>
              <td class="text-center">
                @if (b.claimedAmount != null) { <span class="font-semibold">{{ b.claimedAmount }}</span> } @else { — }
              </td>
              <td>{{ b.createdAt | date: 'short' }}</td>
              <td>
                <p-tag [value]="('BOOKINGS.STATUS.' + b.status) | translate"
                  [severity]="b.status === 'PENDING' ? 'warn' : b.status === 'ACCEPTED' ? 'success' : 'danger'"></p-tag>
              </td>
              <td class="text-center">
                @if (b.hasPaymentPhoto) {
                  <p-button [text]="true" size="small" [rounded]="true" icon="pi pi-image"
                    [pTooltip]="'BOOKINGS.VIEW_PHOTO' | translate" (onClick)="viewPhoto(b)"></p-button>
                }
                @if (b.status === 'PENDING') {
                  <p-button [text]="true" size="small" [rounded]="true" icon="pi pi-check" severity="success"
                    [pTooltip]="'BOOKINGS.ACCEPT' | translate" (onClick)="openAccept(b)"></p-button>
                  <p-button [text]="true" size="small" [rounded]="true" icon="pi pi-times" severity="danger"
                    [pTooltip]="'BOOKINGS.REJECT' | translate" (onClick)="confirmReject(b)"></p-button>
                }
                @if (b.status === 'ACCEPTED' && b.studentId) {
                  <p-button [text]="true" size="small" [rounded]="true" icon="pi pi-user"
                    [pTooltip]="'BOOKINGS.OPEN_STUDENT' | translate" (onClick)="openStudent(b)"></p-button>
                }
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="7" class="text-center py-8 text-gray-500">{{ 'BOOKINGS.EMPTY' | translate }}</td></tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>

    <!-- Payment photo -->
    <p-dialog [visible]="showPhoto()" (visibleChange)="showPhoto.set($event)" [modal]="true"
      [header]="'BOOKINGS.PHOTO_TITLE' | translate" [style]="{ width: '520px', maxWidth: '95vw' }">
      @if (photoLoading()) {
        <div class="text-center py-10 text-gray-400"><i class="pi pi-spin pi-spinner text-2xl"></i></div>
      } @else if (photo()) {
        <img [src]="photo()" class="w-full rounded-lg" alt="payment" />
      } @else {
        <p class="text-center text-gray-500 py-6">{{ 'BOOKINGS.NO_PHOTO' | translate }}</p>
      }
    </p-dialog>

    <!-- Accept -->
    <p-dialog [visible]="showAccept()" (visibleChange)="showAccept.set($event)" [modal]="true"
      [header]="'BOOKINGS.ACCEPT_TITLE' | translate" [style]="{ width: '440px' }">
      @if (selected(); as b) {
        <div class="flex flex-col gap-4 pt-2">
          <div class="p-3 bg-blue-50 border border-blue-200 rounded">
            <div class="font-semibold text-blue-900">{{ b.studentName }}</div>
            <div class="text-sm text-blue-700 mt-1">{{ b.courseName }}@if (b.className) { · {{ b.className }} }</div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">{{ 'BOOKINGS.CONFIRM_AMOUNT' | translate }}</label>
            <p-inputnumber [(ngModel)]="acceptAmount" [min]="0" [style]="{ width: '100%' }"></p-inputnumber>
            <small class="text-gray-500">{{ 'BOOKINGS.CONFIRM_AMOUNT_HINT' | translate }}</small>
          </div>
        </div>
      }
      <ng-template pTemplate="footer">
        <p-button [label]="'BOOKINGS.CANCEL' | translate" severity="secondary" [outlined]="true" (onClick)="showAccept.set(false)"></p-button>
        <p-button [label]="'BOOKINGS.ACCEPT' | translate" icon="pi pi-check" severity="success"
          [loading]="acting()" (onClick)="accept()"></p-button>
      </ng-template>
    </p-dialog>

    <p-confirmDialog></p-confirmDialog>
  `,
})
export class BookingsListComponent implements OnInit {
  private api = inject(ApiService);
  private notifications = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  private router = inject(Router);

  bookings = signal<BookingRow[]>([]);
  loading = signal(true);
  acting = signal(false);
  link = signal('');
  copied = signal(false);
  statusFilter = signal<'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ALL'>('PENDING');

  showPhoto = signal(false);
  photoLoading = signal(false);
  photo = signal<string | null>(null);

  showAccept = signal(false);
  selected = signal<BookingRow | null>(null);
  acceptAmount: number | null = null;

  get statusOptions() {
    return [
      { label: this.translate.instant('BOOKINGS.STATUS.PENDING'), value: 'PENDING' },
      { label: this.translate.instant('BOOKINGS.STATUS.ACCEPTED'), value: 'ACCEPTED' },
      { label: this.translate.instant('BOOKINGS.STATUS.REJECTED'), value: 'REJECTED' },
      { label: this.translate.instant('BOOKINGS.STATUS.ALL'), value: 'ALL' },
    ];
  }

  ngOnInit(): void {
    this.api.get<{ url: string }>('bookings/link').subscribe({
      next: (r) => this.link.set(r.url),
      error: () => {},
    });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    const status = this.statusFilter();
    this.api.get<BookingRow[]>('bookings', status === 'ALL' ? undefined : { status }).subscribe({
      next: (rows) => { this.bookings.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  copyLink(): void {
    navigator.clipboard?.writeText(this.link()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    }).catch(() => {});
  }

  viewPhoto(b: BookingRow): void {
    this.showPhoto.set(true);
    this.photoLoading.set(true);
    this.photo.set(null);
    this.api.get<{ photo: string | null }>(`bookings/${b.id}/photo`).subscribe({
      next: (r) => { this.photo.set(r.photo); this.photoLoading.set(false); },
      error: () => this.photoLoading.set(false),
    });
  }

  openAccept(b: BookingRow): void {
    this.selected.set(b);
    this.acceptAmount = b.claimedAmount;
    this.showAccept.set(true);
  }

  accept(): void {
    const b = this.selected();
    if (!b) return;
    this.acting.set(true);
    this.api.post(`bookings/${b.id}/accept`, { amountPaid: this.acceptAmount ?? undefined }).subscribe({
      next: () => {
        this.acting.set(false);
        this.showAccept.set(false);
        this.notifications.success(this.translate.instant('BOOKINGS.ACCEPTED_TOAST', { name: b.studentName }));
        this.load();
      },
      error: () => this.acting.set(false),
    });
  }

  confirmReject(b: BookingRow): void {
    this.confirmationService.confirm({
      header: this.translate.instant('BOOKINGS.REJECT_TITLE'),
      message: this.translate.instant('BOOKINGS.REJECT_MSG', { name: b.studentName }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.api.post(`bookings/${b.id}/reject`, {}).subscribe({
          next: () => { this.notifications.success(this.translate.instant('BOOKINGS.REJECTED_TOAST')); this.load(); },
        });
      },
    });
  }

  openStudent(b: BookingRow): void {
    if (b.studentId) this.router.navigate(['/students', b.studentId]);
  }
}
