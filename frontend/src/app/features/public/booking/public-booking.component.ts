import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { TranslateModule } from '@ngx-translate/core';
import { LanguageService } from '../../../core/services/language.service';
import { environment } from '../../../../environments/environment';

interface BookingCourse {
  id: string;
  name: string;
  price: number;
  paymentType: string;
  classes: { id: string; name: string; daysOfWeek: string | null; startTime: string | null; endTime: string | null }[];
}

/**
 * Public per-tenant booking form. NO authentication — reached by the link the
 * academy shares (app.netrofit.com/book/<token>). The student records their
 * data, picks a course/class, optionally attaches a photo of their payment,
 * and submits; the academy accepts or rejects it from /bookings inside the app.
 *
 * Standalone at the app root like the public student profile — no chrome, and
 * the same EN/AR toggle via LanguageService.
 */
@Component({
  selector: 'app-public-booking',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <div class="min-h-screen bg-gray-50 py-6 px-4">
      <div class="max-w-xl mx-auto">
        <div class="flex items-center justify-end mb-2">
          <button type="button" (click)="languageService.toggle()"
            class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 text-xs font-medium text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors bg-white">
            <i class="pi pi-globe text-sm"></i>
            <span>{{ 'PUBLIC_BOOKING.LANGUAGE_TOGGLE' | translate }}</span>
          </button>
        </div>

        @if (loading()) {
          <div class="text-center py-24 text-gray-400">
            <i class="pi pi-spin pi-spinner text-3xl"></i>
          </div>
        } @else if (notFound()) {
          <div class="bg-white rounded-xl shadow p-8 text-center text-gray-500">
            <i class="pi pi-exclamation-circle text-4xl mb-3 text-gray-300"></i>
            <p>{{ 'PUBLIC_BOOKING.NOT_FOUND' | translate }}</p>
          </div>
        } @else if (submitted()) {
          <div class="bg-white rounded-xl shadow p-8 text-center">
            <i class="pi pi-check-circle text-5xl text-green-500 mb-4"></i>
            <h2 class="text-xl font-bold text-gray-800 mb-2">{{ 'PUBLIC_BOOKING.SUCCESS_TITLE' | translate }}</h2>
            <p class="text-gray-500">{{ 'PUBLIC_BOOKING.SUCCESS_MSG' | translate }}</p>
          </div>
        } @else {
          <div class="bg-white rounded-xl shadow p-6">
            <h1 class="text-2xl font-bold text-gray-900 mb-1">{{ companyName() }}</h1>
            <p class="text-gray-500 text-sm mb-6">{{ 'PUBLIC_BOOKING.SUBTITLE' | translate }}</p>

            <div class="flex flex-col gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'PUBLIC_BOOKING.NAME' | translate }} <span class="text-red-500">*</span></label>
                <input type="text" [(ngModel)]="form.studentName" class="w-full border rounded-lg px-3 py-2"
                  [class.border-red-500]="attempted() && !nameValid()" [class.border-gray-300]="!(attempted() && !nameValid())"
                  [placeholder]="'PUBLIC_BOOKING.NAME_PH' | translate" />
                @if (attempted() && !nameValid()) {
                  <p class="text-xs text-red-600 mt-1">{{ 'PUBLIC_BOOKING.ERR_NAME' | translate }}</p>
                }
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'PUBLIC_BOOKING.PHONE' | translate }} <span class="text-red-500">*</span></label>
                <input type="tel" [(ngModel)]="form.phone" dir="ltr" class="w-full border rounded-lg px-3 py-2"
                  [class.border-red-500]="attempted() && !phoneValid()" [class.border-gray-300]="!(attempted() && !phoneValid())"
                  placeholder="01XXXXXXXXX" />
                @if (attempted() && !phoneValid()) {
                  <p class="text-xs text-red-600 mt-1">{{ 'PUBLIC_BOOKING.ERR_PHONE' | translate }}</p>
                }
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'PUBLIC_BOOKING.PARENT_PHONE' | translate }}</label>
                <input type="tel" [(ngModel)]="form.parentPhone" dir="ltr" class="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="01XXXXXXXXX" />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'PUBLIC_BOOKING.COURSE' | translate }} <span class="text-red-500">*</span></label>
                <select [(ngModel)]="form.courseId" (ngModelChange)="form.classId = ''" class="w-full border rounded-lg px-3 py-2 bg-white"
                  [class.border-red-500]="attempted() && !form.courseId" [class.border-gray-300]="!(attempted() && !form.courseId)">
                  <option value="">{{ 'PUBLIC_BOOKING.PICK_COURSE' | translate }}</option>
                  @for (c of courses(); track c.id) {
                    <option [value]="c.id">{{ c.name }} — {{ c.price }} {{ c.paymentType === 'MONTHLY_SUBSCRIPTION' ? ('PUBLIC_BOOKING.PER_MONTH' | translate) : (c.paymentType === 'PER_SESSION' ? ('PUBLIC_BOOKING.PER_SESSION' | translate) : '') }}</option>
                  }
                </select>
                @if (attempted() && !form.courseId) {
                  <p class="text-xs text-red-600 mt-1">{{ 'PUBLIC_BOOKING.ERR_COURSE' | translate }}</p>
                }
              </div>

              @if (selectedCourse(); as course) {
                <div class="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <span class="text-sm font-medium text-blue-900">{{ 'PUBLIC_BOOKING.PRICE' | translate }}</span>
                  <span class="text-lg font-bold text-blue-900" dir="ltr">
                    {{ course.price }}
                    <span class="text-sm font-medium">{{ course.paymentType === 'MONTHLY_SUBSCRIPTION' ? ('PUBLIC_BOOKING.PER_MONTH' | translate) : (course.paymentType === 'PER_SESSION' ? ('PUBLIC_BOOKING.PER_SESSION' | translate) : '') }}</span>
                  </span>
                </div>
              }

              @if (selectedCourse(); as course) {
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'PUBLIC_BOOKING.CLASS' | translate }} <span class="text-red-500">*</span></label>
                  @if (course.classes.length) {
                    <select [(ngModel)]="form.classId" class="w-full border rounded-lg px-3 py-2 bg-white"
                      [class.border-red-500]="attempted() && !form.classId" [class.border-gray-300]="!(attempted() && !form.classId)">
                      <option value="">{{ 'PUBLIC_BOOKING.PICK_CLASS' | translate }}</option>
                      @for (cl of course.classes; track cl.id) {
                        <option [value]="cl.id">{{ cl.name }}{{ classTime(cl) }}</option>
                      }
                    </select>
                    @if (attempted() && !form.classId) {
                      <p class="text-xs text-red-600 mt-1">{{ 'PUBLIC_BOOKING.ERR_CLASS' | translate }}</p>
                    }
                  } @else {
                    <p class="text-sm text-red-600">{{ 'PUBLIC_BOOKING.NO_CLASSES' | translate }}</p>
                  }
                </div>
              }

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'PUBLIC_BOOKING.NOTES' | translate }}</label>
                <textarea [(ngModel)]="form.notes" rows="2" class="w-full border border-gray-300 rounded-lg px-3 py-2" [placeholder]="'PUBLIC_BOOKING.NOTES_PH' | translate"></textarea>
              </div>

              <div class="border border-dashed border-gray-300 rounded-lg p-4 bg-gray-50">
                <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'PUBLIC_BOOKING.PAYMENT_TITLE' | translate }}</label>
                <p class="text-xs text-gray-500 mb-3">{{ 'PUBLIC_BOOKING.PAYMENT_HINT' | translate }}</p>
                <div class="flex flex-col gap-3">
                  <div>
                    <label class="block text-xs text-gray-600 mb-1">{{ 'PUBLIC_BOOKING.PAID_AMOUNT' | translate }}</label>
                    <input type="number" [(ngModel)]="form.claimedAmount" min="0" [max]="maxPay()" class="w-full border rounded-lg px-3 py-2"
                      [class.border-red-500]="!payValid()" [class.border-gray-300]="payValid()" />
                    @if (!payValid()) {
                      <p class="text-xs text-red-600 mt-1">{{ 'PUBLIC_BOOKING.ERR_PAY_MAX' | translate: { max: maxPay() } }}</p>
                    }
                  </div>
                  <div>
                    <label class="block text-xs text-gray-600 mb-1">{{ 'PUBLIC_BOOKING.PAYMENT_PHOTO' | translate }}</label>
                    <input type="file" accept="image/*" (change)="onPhotoPicked($event)" class="w-full text-sm" />
                    @if (photoName()) {
                      <p class="text-xs text-green-600 mt-1"><i class="pi pi-check me-1"></i>{{ photoName() }}</p>
                    }
                    @if (photoError()) {
                      <p class="text-xs text-red-600 mt-1">{{ photoError() | translate }}</p>
                    }
                  </div>
                </div>
              </div>

              @if (error()) {
                <p class="text-sm text-red-600 text-center">{{ error() | translate }}</p>
              }

              <!-- Always clickable: a disabled button explains nothing. Clicking
                   with missing fields marks each one in red instead. -->
              <button type="button" (click)="submit()"
                [disabled]="submitting()"
                class="w-full py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                @if (submitting()) { <i class="pi pi-spin pi-spinner me-2"></i> }
                {{ 'PUBLIC_BOOKING.SUBMIT' | translate }}
              </button>
              @if (attempted() && !formValid()) {
                <p class="text-sm text-red-600 text-center -mt-1">{{ 'PUBLIC_BOOKING.FIX_FIELDS' | translate }}</p>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class PublicBookingComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  languageService = inject(LanguageService);

  private token = '';
  loading = signal(true);
  notFound = signal(false);
  submitted = signal(false);
  submitting = signal(false);
  error = signal('');
  photoName = signal('');
  photoError = signal('');
  companyName = signal('');
  courses = signal<BookingCourse[]>([]);

  form = { studentName: '', phone: '', parentPhone: '', courseId: '', classId: '', notes: '', claimedAmount: null as number | null };
  private paymentPhoto: string | null = null;

  /** Set on the first submit click — before it, no red ink on an untouched form. */
  attempted = signal(false);

  /**
   * A plain method, NOT a computed(): form.courseId is a mutable field, not a
   * signal, and a computed that reads it evaluates once and caches null forever
   * — which is exactly how the class picker never appeared.
   */
  selectedCourse(): BookingCourse | null {
    return this.courses().find(c => c.id === this.form.courseId) || null;
  }

  nameValid(): boolean { return this.form.studentName.trim().length >= 2; }
  phoneValid(): boolean { return this.form.phone.replace(/[^\d]/g, '').length >= 8; }

  /**
   * The most a student may claim to have paid up-front: one month's fee for a
   * subscription, the course price for everything else. Anything above it is a
   * typo or a misunderstanding the office would have to unwind.
   */
  maxPay(): number { return this.selectedCourse()?.price ?? 0; }
  payValid(): boolean {
    const a = this.form.claimedAmount;
    if (a == null) return true;
    return a >= 0 && (!this.selectedCourse() || a <= this.maxPay());
  }

  formValid(): boolean { return this.nameValid() && this.phoneValid() && !!this.form.courseId && !!this.form.classId && this.payValid(); }

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    this.http.get<any>(`${environment.apiUrl}/public/booking/${this.token}`).subscribe({
      next: (info) => {
        this.companyName.set(info.companyName);
        this.courses.set(info.courses || []);
        this.loading.set(false);
      },
      error: () => { this.notFound.set(true); this.loading.set(false); },
    });
  }

  classTime(cl: { daysOfWeek: string | null; startTime: string | null; endTime: string | null }): string {
    if (!cl.startTime || !cl.endTime) return '';
    return ` (${(cl.startTime || '').slice(0, 5)}–${(cl.endTime || '').slice(0, 5)})`;
  }

  onPhotoPicked(event: Event): void {
    this.photoError.set('');
    this.photoName.set('');
    this.paymentPhoto = null;
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { this.photoError.set('PUBLIC_BOOKING.PHOTO_NOT_IMAGE'); return; }
    if (file.size > 3 * 1024 * 1024) { this.photoError.set('PUBLIC_BOOKING.PHOTO_TOO_BIG'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      this.paymentPhoto = String(reader.result || '');
      this.photoName.set(file.name);
    };
    reader.readAsDataURL(file);
  }

  submit(): void {
    this.attempted.set(true);
    if (!this.formValid()) return;
    this.error.set('');
    this.submitting.set(true);
    this.http.post<any>(`${environment.apiUrl}/public/booking/${this.token}`, {
      studentName: this.form.studentName.trim(),
      phone: this.form.phone.trim(),
      parentPhone: this.form.parentPhone.trim() || undefined,
      courseId: this.form.courseId,
      classId: this.form.classId,
      notes: this.form.notes.trim() || undefined,
      claimedAmount: this.form.claimedAmount ?? undefined,
      paymentPhoto: this.paymentPhoto ?? undefined,
    }).subscribe({
      next: () => { this.submitting.set(false); this.submitted.set(true); },
      error: () => { this.submitting.set(false); this.error.set('PUBLIC_BOOKING.SUBMIT_FAILED'); },
    });
  }
}
