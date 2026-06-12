import { PaymentMethod } from '../enums/enrollment-status.enum';
import { DiscountType } from '../enums/product.enum';

export interface ProductSale {
  id: string;
  companyId: string;
  branchId: string;
  productId: string;
  productName: string | null;
  studentId?: string | null;
  studentName?: string | null;
  courseId?: string | null;
  enrollmentId?: string | null;
  quantity: number;
  unitPrice: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  subtotal: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  receiptNumber?: string;
  notes?: string;
  soldBy?: string;
  customerName?: string;
  customerPhone?: string;
  revenueId: string;
  date: string;
  saleDate: string;
  totalRefunded?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSaleCreateDto {
  branchId: string;
  productId: string;
  quantity: number;
  discountType?: DiscountType;
  discountValue?: number;
  paymentMethod?: PaymentMethod;
  receiptNumber?: string;
  notes?: string;
  customerName?: string;
  customerPhone?: string;
  date: string;
  // Educational Books: attribute the sale to a student/course/enrollment.
  studentId?: string | null;
  courseId?: string | null;
  enrollmentId?: string | null;
}

export interface ProductSaleUpdateDto {
  notes?: string;
  receiptNumber?: string;
}
