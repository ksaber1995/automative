import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const PRODUCTS_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'list',
    pathMatch: 'full',
  },
  {
    path: 'list',
    loadComponent: () =>
      import('./product-list/product-list.component').then(
        (m) => m.ProductListComponent,
      ),
  },
  {
    path: 'create',
    canActivate: [permissionGuard('products', 'write')],
    loadComponent: () =>
      import('./product-form/product-form.component').then(
        (m) => m.ProductFormComponent,
      ),
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard('products', 'write')],
    loadComponent: () =>
      import('./product-form/product-form.component').then(
        (m) => m.ProductFormComponent,
      ),
  },
  {
    path: 'sell',
    canActivate: [permissionGuard('product_sales', 'write')],
    loadComponent: () =>
      import('./product-sale/product-sale.component').then(
        (m) => m.ProductSaleComponent,
      ),
  },
  {
    path: 'sales',
    canActivate: [permissionGuard('product_sales')],
    loadComponent: () =>
      import('./sales-history/sales-history.component').then(
        (m) => m.SalesHistoryComponent,
      ),
  },
];
