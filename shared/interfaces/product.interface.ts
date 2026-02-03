import { ProductCategory } from '../enums/product.enum';

export interface Product {
  id: string;
  name: string;
  code: string;
  description: string;
  category: ProductCategory;
  costPrice: number;
  sellingPrice: number;
  stock: number;
  minStock: number;
  unit: string;
  isGlobal: boolean;
  branchId: string | null;
  isActive: boolean;
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
  isGlobal: boolean;
  branchId?: string | null;
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
