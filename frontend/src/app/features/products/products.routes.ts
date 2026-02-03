import { Routes } from '@angular/router';

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
    loadComponent: () =>
      import('./product-form/product-form.component').then(
        (m) => m.ProductFormComponent,
      ),
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('./product-form/product-form.component').then(
        (m) => m.ProductFormComponent,
      ),
  },
  {
    path: 'sell',
    loadComponent: () =>
      import('./product-sale/product-sale.component').then(
        (m) => m.ProductSaleComponent,
      ),
  },
  {
    path: 'sales',
    loadComponent: () =>
      import('./sales-history/sales-history.component').then(
        (m) => m.SalesHistoryComponent,
      ),
  },
];
