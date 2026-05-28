import { ProductCategory } from '../enums/product.enum';

export interface Product {
  id: string;
  companyId: string;
  name: string;
  code: string;
  description: string;
  category: ProductCategory;
  costPrice: number;
  sellingPrice: number;
  stock: number;
  minStock: number;
  unit: string;
  branchId: string;
  isActive: boolean;
  totalSold?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductCreateDto {
  name: string;
  code: string;
  description: string;
  category: ProductCategory;
  costPrice: number;
  sellingPrice: number;
  stock: number;
  minStock: number;
  unit: string;
  branchId: string;
}

export interface ProductUpdateDto {
  name?: string;
  code?: string;
  description?: string;
  category?: ProductCategory;
  costPrice?: number;
  sellingPrice?: number;
  stock?: number;
  minStock?: number;
  unit?: string;
  isActive?: boolean;
}
