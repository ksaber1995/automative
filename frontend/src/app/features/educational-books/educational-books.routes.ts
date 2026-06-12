import { Routes } from '@angular/router';

export const EDUCATIONAL_BOOKS_ROUTES: Routes = [
  { path: '', redirectTo: 'list', pathMatch: 'full' },
  {
    path: 'list',
    loadComponent: () =>
      import('./educational-books-list/educational-books-list.component').then(
        (m) => m.EducationalBooksListComponent,
      ),
  },
  {
    path: ':courseId',
    loadComponent: () =>
      import('./educational-books-detail/educational-books-detail.component').then(
        (m) => m.EducationalBooksDetailComponent,
      ),
    data: { breadcrumb: 'BREADCRUMBS.EDUCATIONAL_BOOKS_DETAIL' },
  },
];
