import { Component, OnInit, OnDestroy, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Html5Qrcode } from 'html5-qrcode';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { NotificationService } from '../../../core/services/notification.service';
import { EducationalBooksService } from '../services/educational-books.service';
import { ProductSaleService } from '../../products/services/product-sale.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { GlobalScanService } from '../../../core/services/global-scan.service';
import { ScanPreferenceService } from '../../../core/services/scan-preference.service';
import { StudentService } from '../../students/services/student.service';
import {
  EducationalBooksCourseDetail,
  EducationalBooksProductDetail,
  BookNonBuyer,
} from '@shared/interfaces/course-product.interface';
import { DiscountType } from '@shared/enums/product.enum';
import { PaymentMethod } from '@shared/enums/enrollment-status.enum';

/** A product the scanned student hasn't bought yet (one option in the picker). */
interface ScanSellOption {
  product: EducationalBooksProductDetail;
  student: BookNonBuyer;
}

@Component({
  selector: 'app-educational-books-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TagModule, DialogModule,
    InputNumberModule, InputTextModule, DatePickerModule, SelectModule, TableModule, TooltipModule,
    TranslateModule, AmountPipe,
  ],
  templateUrl: './educational-books-detail.component.html',
})
export class EducationalBooksDetailComponent implements OnInit, OnDestroy {
  private educationalBooksService = inject(EducationalBooksService);
  private productSaleService = inject(ProductSaleService);
  private lookupService = inject(LookupService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private globalScan = inject(GlobalScanService);
  private scanPref = inject(ScanPreferenceService);
  private studentService = inject(StudentService);

  DiscountType = DiscountType;

  courseId = '';
  courseDetail = signal<EducationalBooksCourseDetail | null>(null);
  branches = signal<LookupOption[]>([]);
  loading = signal(false);

  // Live search over the roster by student name or short code.
  search = signal('');

  branchOptions = computed(() =>
    this.branches().map((b) => ({ label: b.label, value: b.id })),
  );

  /**
   * Products with their buyer/non-buyer lists filtered by the search term
   * (name or code). When a query is active, products with no matching student
   * are dropped so the page only shows relevant rows.
   */
  filteredProducts = computed(() => {
    const detail = this.courseDetail();
    if (!detail) return [];
    const q = this.search().trim().toLowerCase();
    if (!q) return detail.products;
    const match = (s: { studentName: string | null; studentCode?: number | string | null }) => {
      const name = (s.studentName || '').toLowerCase();
      const code = s.studentCode != null ? String(s.studentCode).toLowerCase() : '';
      return name.includes(q) || code.includes(q);
    };
    return detail.products
      .map((p) => ({ ...p, buyers: p.buyers.filter(match), nonBuyers: p.nonBuyers.filter(match) }))
      .filter((p) => p.buyers.length > 0 || p.nonBuyers.length > 0);
  });

  paymentMethodOptions = [
    { label: 'EDUCATIONAL_BOOKS.METHOD_CASH', value: PaymentMethod.CASH },
    { label: 'EDUCATIONAL_BOOKS.METHOD_CREDIT_CARD', value: PaymentMethod.CREDIT_CARD },
    { label: 'EDUCATIONAL_BOOKS.METHOD_DEBIT_CARD', value: PaymentMethod.DEBIT_CARD },
    { label: 'EDUCATIONAL_BOOKS.METHOD_BANK_TRANSFER', value: PaymentMethod.BANK_TRANSFER },
    { label: 'EDUCATIONAL_BOOKS.METHOD_CHECK', value: PaymentMethod.CHECK },
    { label: 'EDUCATIONAL_BOOKS.METHOD_OTHER', value: PaymentMethod.OTHER },
  ];

  discountTypeOptions = [
    { label: 'EDUCATIONAL_BOOKS.DISCOUNT_NONE', value: DiscountType.NONE },
    { label: 'EDUCATIONAL_BOOKS.DISCOUNT_PERCENTAGE', value: DiscountType.PERCENTAGE },
    { label: 'EDUCATIONAL_BOOKS.DISCOUNT_FIXED', value: DiscountType.FIXED_AMOUNT },
  ];

  // Sell dialog state
  showSellDialog = false;
  submitting = signal(false);
  sellingProduct = signal<EducationalBooksProductDetail | null>(null);
  sellingStudent = signal<BookNonBuyer | null>(null);
  sellQuantity = signal<number>(1);
  sellDiscountType = signal<DiscountType>(DiscountType.NONE);
  sellDiscountValue = signal<number>(0);
  sellDate: Date = new Date();
  sellPaymentMethod = signal<PaymentMethod | null>(PaymentMethod.CASH);
  sellBranchId = signal<string | null>(null);

  // ── Pay by QR / scan-to-sell (mirrors the monthly-subscriptions flow) ─────────
  scannerOpen = signal(false);
  scannerStarting = signal(false);
  cameraStarted = signal(false);
  resolvingToken = signal(false);
  manualToken = signal('');
  // QR-less fallback: staff types the student's short sequential code + Enter.
  manualCode = signal('');
  resolvingCode = signal(false);
  // Product picker shown after a scan when the student has >1 unbought product.
  showProductPicker = signal(false);
  scanStudentName = signal('');
  scanProductOptions = signal<ScanSellOption[]>([]);
  private readonly SCANNER_ELEMENT_ID = 'books-qr-region';
  private html5Qr?: Html5Qrcode;
  private lastToken = '';
  private lastTokenAt = 0;
  private readonly SCAN_DEDUP_MS = 2500;
  private readonly scanHandler = (token: string) => this.resolveToken(token);

  usbDetected = () => this.scanPref.usbDetected();

  unitPrice = computed(() => this.sellingProduct()?.sellingPrice || 0);

  subtotal = computed(() => this.unitPrice() * (this.sellQuantity() || 0));

  discountAmount = computed(() => {
    const type = this.sellDiscountType();
    const value = this.sellDiscountValue() || 0;
    const sub = this.subtotal();
    if (type === DiscountType.PERCENTAGE) return (sub * value) / 100;
    if (type === DiscountType.FIXED_AMOUNT) return value;
    return 0;
  });

  totalAmount = computed(() => Math.max(0, this.subtotal() - this.discountAmount()));

  // Whether a branch must be chosen in the dialog (global course has no branch).
  needsBranchSelect = computed(() => !this.courseDetail()?.branchId);

  ngOnInit() {
    this.courseId = this.route.snapshot.paramMap.get('courseId') || '';
    // Take over the app-wide scanner while this page is open so a scan runs the
    // sell flow here instead of navigating to the student's detail page.
    this.globalScan.register(this.scanHandler);
    this.loadDetail();
    this.lookupService.branches().subscribe({
      next: (b) => this.branches.set(b),
    });
  }

  ngOnDestroy() {
    this.globalScan.unregister(this.scanHandler);
    this.stopCamera();
  }

  loadDetail() {
    if (!this.courseId) return;
    this.loading.set(true);
    this.educationalBooksService.getCourseDetail(this.courseId).subscribe({
      next: (data) => {
        this.courseDetail.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading course detail:', err);
        this.loading.set(false);
      },
    });
  }

  back() {
    this.router.navigate(['/educational-books']);
  }

  openSellDialog(product: EducationalBooksProductDetail, student: BookNonBuyer) {
    this.sellingProduct.set(product);
    this.sellingStudent.set(student);
    this.sellQuantity.set(1);
    this.sellDiscountType.set(product.defaultDiscountType || DiscountType.NONE);
    this.sellDiscountValue.set(product.defaultDiscountValue || 0);
    this.sellDate = new Date();
    this.sellPaymentMethod.set(PaymentMethod.CASH);
    // Pre-fill branch from the course when it has one; otherwise force a choice.
    this.sellBranchId.set(this.courseDetail()?.branchId ?? null);
    this.showSellDialog = true;
  }

  // ── Scan-to-sell flow ─────────────────────────────────────────────────────────

  openScanner(): void {
    this.scannerOpen.set(true);
    this.manualToken.set('');
    this.lastToken = '';
    // USB scanner is first priority: skip the camera when one is known on this
    // device. Camera is the explicit fallback.
    if (this.usbDetected()) return;
    this.cameraStarted.set(true);
    setTimeout(() => this.startCamera(), 0);
  }

  /** Explicit fallback: start the camera even when a USB scanner exists. */
  useCamera(): void {
    this.cameraStarted.set(true);
    setTimeout(() => this.startCamera(), 50);
  }

  closeScanner(): void {
    this.stopCamera();
    this.scannerOpen.set(false);
  }

  private async startCamera(): Promise<void> {
    if (this.html5Qr) return;
    this.scannerStarting.set(true);
    try {
      this.html5Qr = new Html5Qrcode(this.SCANNER_ELEMENT_ID);
      await this.html5Qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => this.handleScan(decodedText),
        () => {},
      );
    } catch {
      this.notificationService.error(this.translate.instant('EDUCATIONAL_BOOKS.SCAN_CAMERA_FAILED'));
      this.html5Qr = undefined;
    } finally {
      this.scannerStarting.set(false);
    }
  }

  private stopCamera(): void {
    this.cameraStarted.set(false);
    const qr = this.html5Qr;
    this.html5Qr = undefined;
    if (!qr) return;
    qr.stop().then(() => qr.clear()).catch(() => {});
  }

  /** Extract the token from a scanned value: either a profile URL or the raw token. */
  private extractToken(text: string): string {
    const raw = (text || '').trim();
    const marker = '/p/s/';
    const idx = raw.indexOf(marker);
    if (idx >= 0) return raw.slice(idx + marker.length).split(/[/?#]/)[0];
    return raw;
  }

  /** Camera decode callback. */
  private handleScan(decodedText: string): void {
    const token = this.extractToken(decodedText);
    if (!token) return;
    const now = Date.now();
    if (token === this.lastToken && now - this.lastTokenAt < this.SCAN_DEDUP_MS) return;
    this.lastToken = token;
    this.lastTokenAt = now;
    this.resolveToken(token);
  }

  /** USB scanner / manual token entry submit (Enter key). */
  submitManualToken(): void {
    const token = this.extractToken(this.manualToken());
    this.manualToken.set('');
    if (!token) return;
    this.resolveToken(token);
  }

  /**
   * QR-less scan-to-sell by short student code (Enter key). Resolves the code to
   * the student, then runs the same find-unbought-products flow.
   */
  submitManualCode(): void {
    const code = this.manualCode().trim();
    this.manualCode.set('');
    if (!code || this.resolvingCode()) return;
    this.resolvingCode.set(true);
    this.studentService.lookupByCode(code).subscribe({
      next: ({ id }) => {
        this.resolvingCode.set(false);
        this.resolveStudentId(id);
      },
      error: () => {
        // Interceptor toasts the translated "no student with this code" message.
        this.resolvingCode.set(false);
      },
    });
  }

  /** Resolve a scanned QR token to a student, then run the sell flow. */
  private resolveToken(token: string): void {
    if (this.resolvingToken()) return;
    this.resolvingToken.set(true);
    this.studentService.lookupByQr(token).subscribe({
      next: ({ id }) => {
        this.resolvingToken.set(false);
        this.resolveStudentId(id);
      },
      error: () => {
        this.resolvingToken.set(false);
        // Interceptor toasts the translated/fallback server error (unknown token).
      },
    });
  }

  /**
   * Given a resolved student id, find which of this course's products they
   * haven't bought yet. None enrolled → info; all bought → info; exactly one →
   * open the sell dialog; more than one → show the product picker.
   */
  private resolveStudentId(studentId: string): void {
    const detail = this.courseDetail();
    if (!detail) return;
    const options: ScanSellOption[] = [];
    let studentName = '';
    let inRoster = false;
    for (const product of detail.products) {
      const nb = product.nonBuyers.find((s) => s.studentId === studentId);
      if (nb) {
        options.push({ product, student: nb });
        if (nb.studentName) studentName = nb.studentName;
        inRoster = true;
        continue;
      }
      const buyer = product.buyers.find((b) => b.studentId === studentId);
      if (buyer) {
        if (buyer.studentName) studentName = buyer.studentName;
        inRoster = true;
      }
    }

    if (!inRoster) {
      this.notificationService.info(this.translate.instant('EDUCATIONAL_BOOKS.SCAN_NOT_ENROLLED'));
      return;
    }
    if (options.length === 0) {
      this.notificationService.info(
        this.translate.instant('EDUCATIONAL_BOOKS.SCAN_ALL_BOUGHT', { name: studentName || '' }),
      );
      return;
    }

    this.closeScanner();
    if (options.length === 1) {
      this.openSellDialog(options[0].product, options[0].student);
      return;
    }
    this.scanStudentName.set(studentName);
    this.scanProductOptions.set(options);
    this.showProductPicker.set(true);
  }

  closeProductPicker(): void {
    this.showProductPicker.set(false);
    this.scanProductOptions.set([]);
  }

  /** A product was picked after a scan — open the sell dialog for it. */
  selectScanProduct(option: ScanSellOption): void {
    this.closeProductPicker();
    this.openSellDialog(option.product, option.student);
  }

  canSubmit(): boolean {
    if (!this.sellingProduct() || !this.sellingStudent()) return false;
    if ((this.sellQuantity() || 0) < 1) return false;
    if (this.needsBranchSelect() && !this.sellBranchId()) return false;
    if (!this.sellDate) return false;
    return true;
  }

  /** Local YYYY-MM-DD (avoids the UTC shift from toISOString). */
  private formatLocalDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  confirmSell() {
    const product = this.sellingProduct();
    const student = this.sellingStudent();
    const branchId = this.sellBranchId();
    if (!product || !student || !branchId || !this.canSubmit()) return;

    this.submitting.set(true);
    this.productSaleService.createSale({
      productId: product.productId,
      branchId,
      quantity: this.sellQuantity(),
      discountType: this.sellDiscountType(),
      discountValue: this.sellDiscountValue() || 0,
      date: this.formatLocalDate(this.sellDate),
      paymentMethod: this.sellPaymentMethod() || undefined,
      studentId: student.studentId,
      courseId: this.courseId,
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.showSellDialog = false;
        this.notificationService.success(
          this.translate.instant('EDUCATIONAL_BOOKS.PAYMENT_RECORDED'),
        );
        this.loadDetail();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.submitting.set(false);
      },
    });
  }
}
