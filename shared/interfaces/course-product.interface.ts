import { DiscountType } from '../enums/product.enum';

/** A product (usually a book) linked to a course. */
export interface CourseProduct {
  id: string;
  companyId: string;
  courseId: string;
  productId: string;
  isRequired: boolean;
  defaultDiscountType: DiscountType;
  defaultDiscountValue: number;
  addedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  // Joined product fields (present on list)
  productName?: string;
  productCode?: string;
  sellingPrice?: number;
  stock?: number;
}

export interface CourseProductCreateDto {
  courseId: string;
  productId: string;
  isRequired?: boolean;
  defaultDiscountType?: DiscountType;
  defaultDiscountValue?: number;
}

export interface CourseProductUpdateDto {
  isRequired?: boolean;
  defaultDiscountType?: DiscountType;
  defaultDiscountValue?: number;
}

// ─── Educational Books aggregate views ────────────────────────────────────────

export interface EducationalBooksCourseSummary {
  courseId: string;
  courseName: string;
  branchId: string | null;
  branchName: string | null;
  linkedProductCount: number;
  enrolledCount: number;
  boughtCount: number;
  notBoughtCount: number;
}

export interface BookBuyer {
  studentId: string;
  studentName: string | null;
  /** Short sequential student code (for search / scan-to-sell). */
  studentCode?: number | string | null;
  /** The class behind the buyer's enrollment — drives the report's class filter. */
  classId?: string | null;
  className?: string | null;
  saleId: string;
  quantity: number;
  totalAmount: number;
  saleDate: string;
  /** Money already refunded against this sale (0 unless partly refunded). */
  totalRefunded?: number;
  /** Units an earlier refund already put back on the shelf. */
  restockedQuantity?: number;
}

export interface BookNonBuyer {
  studentId: string;
  studentName: string | null;
  /** Short sequential student code (for search / scan-to-sell). */
  studentCode?: number | string | null;
  classId?: string | null;
  className?: string | null;
  enrollmentId: string | null;
}

export interface EducationalBooksProductDetail {
  courseProductId: string;
  productId: string;
  productName: string;
  productCode: string | null;
  sellingPrice: number;
  stock: number;
  isRequired: boolean;
  defaultDiscountType: DiscountType;
  defaultDiscountValue: number;
  buyers: BookBuyer[];
  nonBuyers: BookNonBuyer[];
}

export interface EducationalBooksCourseDetail {
  courseId: string;
  courseName: string;
  branchId: string | null;
  enrolledCount: number;
  products: EducationalBooksProductDetail[];
}
