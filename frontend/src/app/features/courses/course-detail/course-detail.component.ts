import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AccordionModule } from 'primeng/accordion';
import { PanelModule } from 'primeng/panel';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmationService } from 'primeng/api';
import { CourseService } from '../services/course.service';
import { ClassService } from '../services/class.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { CourseProductService } from '../../educational-books/services/course-product.service';
import { ProductService } from '../../products/services/product.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Course } from '@shared/interfaces/course.interface';
import { ClassWithDetails } from '@shared/interfaces/class.interface';
import { CourseProduct } from '@shared/interfaces/course-product.interface';
import { Product } from '@shared/interfaces/product.interface';
import { DiscountType } from '@shared/enums/product.enum';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { MonthlySubscriptionsService } from '../../monthly-subscriptions/monthly-subscriptions.service';
import { CourseMonthlyPriceOverride } from '@shared/interfaces/monthly-subscription.interface';

@Component({
  selector: 'app-course-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    AccordionModule,
    PanelModule,
    ConfirmDialogModule,
    TooltipModule,
    DialogModule,
    InputNumberModule,
    DatePickerModule,
    TextareaModule,
    ProgressBarModule,
    SelectButtonModule,
    SelectModule,
    CheckboxModule,
    TranslateModule,
    AmountPipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './course-detail.component.html',
  styleUrl: './course-detail.component.scss'
})
export class CourseDetailComponent implements OnInit {
  private courseService = inject(CourseService);
  private classService = inject(ClassService);
  private enrollmentService = inject(EnrollmentService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private courseProductService = inject(CourseProductService);
  private productService = inject(ProductService);
  protected auth = inject(AuthService);
  private translate = inject(TranslateService);
  private monthlySubService = inject(MonthlySubscriptionsService);

  course = signal<Course | null>(null);
  classes = signal<ClassWithDetails[]>([]);
  enrollments = signal<any[]>([]);
  loading = signal(true);
  loadingEnrollments = signal(false);
  courseId: string | null = null;

  // Payment dialog
  showPaymentDialog = false;
  selectedEnrollment = signal<any | null>(null);
  paymentAmount: number | null = null;
  paymentDate: Date = new Date();
  paymentNotes = '';
  paymentLoading = signal(false);

  // Refund dialog
  showRefundDialog = false;
  refundAmount: number | null = null;
  refundDate: Date = new Date();
  refundType: 'FULL' | 'PARTIAL' = 'PARTIAL';
  refundReason = '';
  refundLoading = signal(false);

  refundTypeOptions = computed(() => [
    { label: this.translate.instant('COURSES.DETAIL.REFUND_TYPE_PARTIAL'), value: 'PARTIAL' },
    { label: this.translate.instant('COURSES.DETAIL.REFUND_TYPE_FULL'), value: 'FULL' },
  ]);

  // ─── Linked products (books) ───────────────────────────────────────────────
  DiscountType = DiscountType;
  linkedProducts = signal<CourseProduct[]>([]);
  loadingLinkedProducts = signal(false);
  allProducts = signal<Product[]>([]);
  linkSaving = signal(false);

  // Add-product form
  newProductId: string | null = null;
  newIsRequired = true;
  newDiscountType: DiscountType = DiscountType.NONE;
  newDiscountValue: number | null = null;

  // Edit-discount dialog
  showDiscountDialog = false;
  editingProduct = signal<CourseProduct | null>(null);
  editDiscountType: DiscountType = DiscountType.NONE;
  editDiscountValue: number | null = null;
  discountSaving = signal(false);

  discountTypeOptions = computed(() => [
    { label: this.translate.instant('COURSES.LINKED_PRODUCTS.DISCOUNT_NONE'), value: DiscountType.NONE },
    { label: this.translate.instant('COURSES.LINKED_PRODUCTS.DISCOUNT_PERCENTAGE'), value: DiscountType.PERCENTAGE },
    { label: this.translate.instant('COURSES.LINKED_PRODUCTS.DISCOUNT_FIXED'), value: DiscountType.FIXED_AMOUNT },
  ]);

  // ─── Monthly price overrides ─────────────────────────────────────────────
  priceOverrides = signal<CourseMonthlyPriceOverride[]>([]);
  loadingOverrides = signal(false);
  showOverrideDialog = false;
  overrideYear: number = new Date().getFullYear();
  overrideMonth: number = new Date().getMonth() + 1;
  overridePrice: number | null = null;
  overrideSaving = signal(false);
  editingOverrideId: string | null = null;

  monthOptions = computed(() => [
    { label: this.translate.instant('MONTHS.JAN'), value: 1 },
    { label: this.translate.instant('MONTHS.FEB'), value: 2 },
    { label: this.translate.instant('MONTHS.MAR'), value: 3 },
    { label: this.translate.instant('MONTHS.APR'), value: 4 },
    { label: this.translate.instant('MONTHS.MAY'), value: 5 },
    { label: this.translate.instant('MONTHS.JUN'), value: 6 },
    { label: this.translate.instant('MONTHS.JUL'), value: 7 },
    { label: this.translate.instant('MONTHS.AUG'), value: 8 },
    { label: this.translate.instant('MONTHS.SEP'), value: 9 },
    { label: this.translate.instant('MONTHS.OCT'), value: 10 },
    { label: this.translate.instant('MONTHS.NOV'), value: 11 },
    { label: this.translate.instant('MONTHS.DEC'), value: 12 },
  ]);

  // Products not yet linked, for the add-product select.
  availableProducts = computed(() => {
    const linkedIds = new Set(this.linkedProducts().map(lp => lp.productId));
    return this.allProducts().filter(p => !linkedIds.has(p.id));
  });

  canManageProducts(): boolean {
    return this.auth.canWrite('academy');
  }

  discountLabel(cp: CourseProduct): string {
    switch (cp.defaultDiscountType) {
      case DiscountType.PERCENTAGE:
        return `${cp.defaultDiscountValue}%`;
      case DiscountType.FIXED_AMOUNT:
        return this.translate.instant('COURSES.LINKED_PRODUCTS.DISCOUNT_FIXED_VALUE', { value: cp.defaultDiscountValue });
      default:
        return this.translate.instant('COURSES.LINKED_PRODUCTS.DISCOUNT_NONE');
    }
  }

  classStatus(cls: ClassWithDetails): 'SCHEDULED' | 'IN_PROGRESS' | 'DONE' {
    if (cls.status) return cls.status;
    if (cls.isFinished) return 'DONE';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (cls.startDate && new Date(cls.startDate).getTime() > today.getTime()) return 'SCHEDULED';
    return 'IN_PROGRESS';
  }

  classStatusLabel(cls: ClassWithDetails): string {
    switch (this.classStatus(cls)) {
      case 'IN_PROGRESS': return this.translate.instant('COURSES.DETAIL.STATUS_IN_PROGRESS');
      case 'SCHEDULED': return this.translate.instant('COURSES.DETAIL.STATUS_SCHEDULED');
      case 'DONE': return this.translate.instant('COURSES.DETAIL.STATUS_DONE');
    }
  }

  classStatusSeverity(cls: ClassWithDetails): 'success' | 'info' | 'secondary' {
    switch (this.classStatus(cls)) {
      case 'IN_PROGRESS': return 'success';
      case 'SCHEDULED': return 'info';
      case 'DONE': return 'secondary';
    }
  }

  ngOnInit() {
    this.courseId = this.route.snapshot.paramMap.get('id');
    if (this.courseId) {
      this.loadCourse(this.courseId);
      this.loadClasses(this.courseId);
      this.loadEnrollments(this.courseId);
      this.loadLinkedProducts(this.courseId);
      this.loadAllProducts();
    }
  }

  // ─── Linked products (books) ───────────────────────────────────────────────
  loadLinkedProducts(courseId: string) {
    this.loadingLinkedProducts.set(true);
    this.courseProductService.list(courseId).subscribe({
      next: (data) => {
        this.linkedProducts.set(data);
        this.loadingLinkedProducts.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loadingLinkedProducts.set(false);
      }
    });
  }

  loadAllProducts() {
    this.productService.getAllProducts().subscribe({
      next: (data) => this.allProducts.set(data),
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  // ─── Price overrides ───────────────────────────────────────────────────────
  loadPriceOverrides(courseId: string) {
    this.loadingOverrides.set(true);
    this.monthlySubService.listPriceOverrides(courseId).subscribe({
      next: (data) => {
        this.priceOverrides.set(data);
        this.loadingOverrides.set(false);
      },
      error: () => this.loadingOverrides.set(false),
    });
  }

  openOverrideDialog(ov?: CourseMonthlyPriceOverride) {
    if (ov) {
      this.editingOverrideId = ov.id;
      this.overrideYear = ov.billingYear;
      this.overrideMonth = ov.billingMonth;
      this.overridePrice = ov.overridePrice;
    } else {
      this.editingOverrideId = null;
      this.overrideYear = new Date().getFullYear();
      this.overrideMonth = new Date().getMonth() + 1;
      this.overridePrice = null;
    }
    this.showOverrideDialog = true;
  }

  closeOverrideDialog() {
    this.showOverrideDialog = false;
    this.editingOverrideId = null;
  }

  saveOverride() {
    if (!this.courseId || this.overridePrice == null || this.overrideSaving()) return;
    this.overrideSaving.set(true);
    this.monthlySubService.setPriceOverride({
      courseId: this.courseId,
      billingYear: this.overrideYear,
      billingMonth: this.overrideMonth,
      overridePrice: this.overridePrice,
    }).subscribe({
      next: (res) => {
        this.notificationService.success(
          this.translate.instant('COURSES.PRICE_OVERRIDES.SAVED', { bills: res.updatedBills })
        );
        this.overrideSaving.set(false);
        this.closeOverrideDialog();
        if (this.courseId) this.loadPriceOverrides(this.courseId);
      },
      error: () => this.overrideSaving.set(false),
    });
  }

  confirmDeleteOverride(ov: CourseMonthlyPriceOverride) {
    const monthLabel = this.monthOptions().find(m => m.value === ov.billingMonth)?.label || '';
    this.confirmationService.confirm({
      header: this.translate.instant('COURSES.PRICE_OVERRIDES.DELETE_TITLE'),
      message: this.translate.instant('COURSES.PRICE_OVERRIDES.DELETE_MSG', { month: monthLabel, year: ov.billingYear }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('COURSES.PRICE_OVERRIDES.DELETE'),
      rejectLabel: this.translate.instant('COURSES.PRICE_OVERRIDES.CANCEL'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.deleteOverride(ov),
    });
  }

  deleteOverride(ov: CourseMonthlyPriceOverride) {
    this.monthlySubService.deletePriceOverride(ov.id).subscribe({
      next: (res) => {
        this.notificationService.success(
          this.translate.instant('COURSES.PRICE_OVERRIDES.DELETED', { bills: res.updatedBills })
        );
        if (this.courseId) this.loadPriceOverrides(this.courseId);
      },
    });
  }

  monthName(month: number): string {
    return this.monthOptions().find(m => m.value === month)?.label || '';
  }

  addLinkedProduct() {
    if (!this.courseId || !this.newProductId || this.linkSaving()) return;
    this.linkSaving.set(true);
    this.courseProductService.link({
      courseId: this.courseId,
      productId: this.newProductId,
      isRequired: this.newIsRequired,
      defaultDiscountType: this.newDiscountType,
      defaultDiscountValue: this.newDiscountType === DiscountType.NONE ? 0 : (this.newDiscountValue || 0),
    }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('COURSES.LINKED_PRODUCTS.PRODUCT_LINKED'));
        this.linkSaving.set(false);
        this.resetAddForm();
        if (this.courseId) this.loadLinkedProducts(this.courseId);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.linkSaving.set(false);
      }
    });
  }

  resetAddForm() {
    this.newProductId = null;
    this.newIsRequired = true;
    this.newDiscountType = DiscountType.NONE;
    this.newDiscountValue = null;
  }

  toggleRequired(cp: CourseProduct) {
    this.courseProductService.update(cp.id, { isRequired: !cp.isRequired }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('COURSES.LINKED_PRODUCTS.PRODUCT_UPDATED'));
        if (this.courseId) this.loadLinkedProducts(this.courseId);
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  openDiscountDialog(cp: CourseProduct) {
    this.editingProduct.set(cp);
    this.editDiscountType = cp.defaultDiscountType;
    this.editDiscountValue = cp.defaultDiscountValue;
    this.showDiscountDialog = true;
  }

  closeDiscountDialog() {
    this.showDiscountDialog = false;
    this.editingProduct.set(null);
  }

  saveDiscount() {
    const cp = this.editingProduct();
    if (!cp || this.discountSaving()) return;
    this.discountSaving.set(true);
    this.courseProductService.update(cp.id, {
      defaultDiscountType: this.editDiscountType,
      defaultDiscountValue: this.editDiscountType === DiscountType.NONE ? 0 : (this.editDiscountValue || 0),
    }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('COURSES.LINKED_PRODUCTS.PRODUCT_UPDATED'));
        this.discountSaving.set(false);
        this.closeDiscountDialog();
        if (this.courseId) this.loadLinkedProducts(this.courseId);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.discountSaving.set(false);
      }
    });
  }

  confirmUnlinkProduct(cp: CourseProduct) {
    this.confirmationService.confirm({
      header: this.translate.instant('COURSES.LINKED_PRODUCTS.UNLINK_TITLE'),
      message: this.translate.instant('COURSES.LINKED_PRODUCTS.UNLINK_MSG', { name: cp.productName || '' }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('COURSES.LINKED_PRODUCTS.UNLINK'),
      rejectLabel: this.translate.instant('COURSES.LINKED_PRODUCTS.CANCEL'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.unlinkProduct(cp),
    });
  }

  unlinkProduct(cp: CourseProduct) {
    this.courseProductService.unlink(cp.id).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('COURSES.LINKED_PRODUCTS.PRODUCT_UNLINKED'));
        if (this.courseId) this.loadLinkedProducts(this.courseId);
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  loadCourse(id: string) {
    this.loading.set(true);
    this.courseService.getCourseById(id).subscribe({
      next: (course) => {
        this.course.set(course);
        this.loading.set(false);
        if (course.paymentType === 'MONTHLY_SUBSCRIPTION') {
          this.loadPriceOverrides(id);
        }
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
        this.router.navigate(['/courses']);
      }
    });
  }

  loadClasses(courseId: string) {
    this.classService.getClassesByCourse(courseId).subscribe({
      next: async (classes) => {
        const classesWithDetails = await Promise.all(
          classes.map(cls =>
            this.classService.getClassWithDetails(cls.id).toPromise()
          )
        );
        this.classes.set(classesWithDetails.filter(c => c !== undefined) as ClassWithDetails[]);
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  loadEnrollments(courseId: string) {
    this.loadingEnrollments.set(true);
    this.courseService.getCourseEnrollments(courseId).subscribe({
      next: (data) => {
        this.enrollments.set(data);
        this.loadingEnrollments.set(false);
      },
      error: () => {
        this.loadingEnrollments.set(false);
      }
    });
  }

  // Payment dialog
  openPaymentDialog(enrollment: any) {
    this.selectedEnrollment.set(enrollment);
    this.paymentAmount = parseFloat((enrollment.finalPrice - enrollment.amountPaid).toFixed(2));
    this.paymentDate = new Date();
    this.paymentNotes = '';
    this.showPaymentDialog = true;
  }

  closePaymentDialog() {
    this.showPaymentDialog = false;
    this.selectedEnrollment.set(null);
  }

  submitPayment() {
    if (!this.paymentAmount || !this.paymentDate) return;
    const enrollmentId = this.selectedEnrollment()?.enrollmentId;
    if (!enrollmentId) return;

    this.paymentLoading.set(true);
    this.enrollmentService.addPayment(enrollmentId, {
      amount: this.paymentAmount,
      paymentDate: this.paymentDate.toISOString().split('T')[0],
      notes: this.paymentNotes || undefined
    }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('COURSES.DETAIL.PAYMENT_RECORDED'));
        this.paymentLoading.set(false);
        this.closePaymentDialog();
        if (this.courseId) this.loadEnrollments(this.courseId);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.paymentLoading.set(false);
      }
    });
  }

  // Refund dialog
  openRefundDialog(enrollment: any) {
    this.selectedEnrollment.set(enrollment);
    const refundable = enrollment.amountPaid - (enrollment.totalRefunded || 0);
    this.refundAmount = parseFloat(refundable.toFixed(2));
    this.refundDate = new Date();
    this.refundType = 'PARTIAL';
    this.refundReason = '';
    this.showRefundDialog = true;
  }

  closeRefundDialog() {
    this.showRefundDialog = false;
    this.selectedEnrollment.set(null);
  }

  submitRefund() {
    if (!this.refundAmount || !this.refundDate) return;
    const enrollmentId = this.selectedEnrollment()?.enrollmentId;
    if (!enrollmentId) return;

    this.refundLoading.set(true);
    this.enrollmentService.createRefund(enrollmentId, {
      amount: this.refundAmount,
      refundDate: this.refundDate.toISOString().split('T')[0],
      type: this.refundType,
      reason: this.refundReason || undefined
    }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('COURSES.DETAIL.REFUND_PROCESSED'));
        this.refundLoading.set(false);
        this.closeRefundDialog();
        if (this.courseId) this.loadEnrollments(this.courseId);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.refundLoading.set(false);
      }
    });
  }

  refundableAmount(enrollment: any): number {
    return Math.max(0, (enrollment.amountPaid || 0) - (enrollment.totalRefunded || 0));
  }

  editCourse() {
    this.router.navigate(['/courses', this.courseId, 'edit']);
  }

  backToList() {
    this.router.navigate(['/courses']);
  }

  createClass() {
    this.router.navigate(['/courses', this.courseId, 'classes', 'create']);
  }

  editClass(classId: string) {
    this.router.navigate(['/courses', this.courseId, 'classes', classId, 'edit']);
  }

  viewStudent(studentId: string) {
    this.router.navigate(['/students', studentId]);
  }

  paymentLabel(status: string): string {
    switch (status?.toUpperCase()) {
      case 'PAID': return this.translate.instant('COURSES.DETAIL.PAYMENT_STATUS_PAID');
      case 'PARTIAL': return this.translate.instant('COURSES.DETAIL.PAYMENT_STATUS_PARTIAL');
      case 'PENDING': return this.translate.instant('COURSES.DETAIL.PAYMENT_STATUS_PENDING');
      case 'REFUNDED': return this.translate.instant('COURSES.DETAIL.PAYMENT_STATUS_REFUNDED');
      default: return status || '';
    }
  }

  enrollmentStatusLabel(status: string): string {
    switch (status?.toUpperCase()) {
      case 'ACTIVE': return this.translate.instant('COURSES.DETAIL.ENROLLMENT_STATUS_ACTIVE');
      case 'COMPLETED': return this.translate.instant('COURSES.DETAIL.ENROLLMENT_STATUS_COMPLETED');
      case 'DROPPED': return this.translate.instant('COURSES.DETAIL.ENROLLMENT_STATUS_DROPPED');
      case 'PENDING': return this.translate.instant('COURSES.DETAIL.ENROLLMENT_STATUS_PENDING');
      default: return status || '';
    }
  }

  getPaymentStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    switch (status?.toUpperCase()) {
      case 'PAID': return 'success';
      case 'PARTIAL': return 'info';
      case 'PENDING': return 'warn';
      case 'OVERDUE': return 'danger';
      case 'REFUNDED': return 'secondary';
      default: return 'secondary';
    }
  }

  getEnrollmentStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    switch (status?.toUpperCase()) {
      case 'ACTIVE': return 'success';
      case 'COMPLETED': return 'info';
      case 'DROPPED': return 'danger';
      case 'PENDING': return 'warn';
      default: return 'secondary';
    }
  }

  formatSchedule(schedule: any): string {
    if (!schedule) return 'N/A';
    const days = schedule.days.join(', ');
    return `${days} ${schedule.startTime} - ${schedule.endTime}`;
  }

  formatDate(date: string): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
}
