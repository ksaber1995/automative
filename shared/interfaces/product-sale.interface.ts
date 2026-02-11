import { PaymentMethod } from '../enums/enrollment-status.enum';
import { DiscountType } from '../enums/product.enum';

export interface ProductSale {
  id: string;
  companyId: string;
  branchId: string;
  productId: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface ProductSaleCreateDto {
  branchId: string;
  productId: string;
  quantity: number;
  discountType: DiscountType;
  discountValue: number;
  paymentMethod: PaymentMethod;
  receiptNumber?: string;
  notes?: string;
  soldBy?: string;
  customerName?: string;
  customerPhone?: string;
  date: string;
}

export interface ProductSaleUpdateDto {
  notes?: string;
  receiptNumber?: string;
}
