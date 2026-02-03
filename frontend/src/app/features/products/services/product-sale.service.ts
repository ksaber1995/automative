import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  ProductSale,
  ProductSaleCreateDto,
  ProductSaleUpdateDto,
} from '@shared/interfaces/product-sale.interface';

export interface SalesSummary {
  totalSales: number;
  totalQuantity: number;
  totalRevenue: number;
  byProduct: Array<{
    productId: string;
    productName: string;
    quantity: number;
    revenue: number;
  }>;
}

export interface TopProduct {
  productId: string;
  productName: string;
  productCode: string;
  quantity: number;
}

@Injectable({
  providedIn: 'root',
})
export class ProductSaleService {
  private api = inject(ApiService);

  getAllSales(params?: {
    branchId?: string;
    productId?: string;
    startDate?: string;
    endDate?: string;
  }): Observable<ProductSale[]> {
    return this.api.get<ProductSale[]>('product-sales', params);
  }

  getSalesSummary(params?: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }): Observable<SalesSummary> {
    return this.api.get<SalesSummary>('product-sales/summary', params);
  }

  getTopProducts(params?: {
    branchId?: string;
    limit?: number;
  }): Observable<TopProduct[]> {
    return this.api.get<TopProduct[]>('product-sales/top-products', params);
  }

  getSaleById(id: string): Observable<ProductSale> {
    return this.api.get<ProductSale>(`product-sales/${id}`);
  }

  createSale(sale: ProductSaleCreateDto): Observable<ProductSale> {
    return this.api.post<ProductSale>('product-sales', sale);
  }

  updateSale(
    id: string,
    sale: ProductSaleUpdateDto,
  ): Observable<ProductSale> {
    return this.api.patch<ProductSale>(`product-sales/${id}`, sale);
  }
}
