import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { NotificationService } from '../../../core/services/notification.service';
import { EducationalBooksService } from '../services/educational-books.service';
import { ProductSaleService } from '../../products/services/product-sale.service';
import { BranchService } from '../../branches/services/branch.service';
import {
  EducationalBooksCourseDetail,
  EducationalBooksProductDetail,
  BookNonBuyer,
} from '@shared/interfaces/course-product.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { DiscountType } from '@shared/enums/product.enum';
import { PaymentMethod } from '@shared/enums/enrollment-status.enum';

@Component({
  selector: 'app-educational-books-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TagModule, DialogModule,
    InputNumberModule, DatePickerModule, SelectModule, TableModule, TooltipModule,
    TranslateModule, AmountPipe,
  ],
  templateUrl: './educational-books-detail.component.html',
})
export class EducationalBooksDetailComponent implements OnInit {
  private educationalBooksService = inject(EducationalBooksService);
  private productSaleService = inject(ProductSaleService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  DiscountType = DiscountType;

  courseId = '';
  courseDetail = signal<EducationalBooksCourseDetail | null>(null);
  branches = signal<Branch[]>([]);
  loading = signal(false);

  branchOptions = computed(() =>
    this.branches().map((b) => ({ label: b.name, value: b.id })),
  );

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
    this.loadDetail();
    this.branchService.getAllBranches().subscribe({
      next: (b) => this.branches.set(b),
    });
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
