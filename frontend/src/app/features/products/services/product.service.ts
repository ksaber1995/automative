import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  Product,
  ProductCreateDto,
  ProductUpdateDto,
} from '@shared/interfaces/product.interface';

@Injectable({
  providedIn: 'root',
})
export class ProductService {
  private api = inject(ApiService);

  getAllProducts(params?: {
    branchId?: string;
    isGlobal?: boolean;
    category?: string;
    isActive?: boolean;
  }): Observable<Product[]> {
    return this.api.get<Product[]>('products', params);
  }

  getAvailableProducts(branchId: string): Observable<Product[]> {
    return this.api.get<Product[]>(`products/available/${branchId}`);
  }

  getLowStockProducts(branchId?: string): Observable<Product[]> {
    return this.api.get<Product[]>(
      'products/low-stock',
      branchId ? { branchId } : {},
    );
  }

  getProductById(id: string): Observable<Product> {
    return this.api.get<Product>(`products/${id}`);
  }

  createProduct(product: ProductCreateDto): Observable<Product> {
    return this.api.post<Product>('products', product);
  }

  updateProduct(id: string, product: ProductUpdateDto): Observable<Product> {
    return this.api.patch<Product>(`products/${id}`, product);
  }

  deleteProduct(id: string): Observable<void> {
    return this.api.delete<void>(`products/${id}`);
  }

  adjustStock(
    id: string,
    quantity: number,
    operation: 'add' | 'subtract',
  ): Observable<Product> {
    return this.api.patch<Product>(`products/${id}/stock`, {
      quantity,
      operation,
    });
  }
}
