import { Routes } from '@angular/router';
import { ClientsPageComponent } from './clients-page.component';
import { ClientDetailComponent } from './client-detail.component';

export const routes: Routes = [
  { path: '', component: ClientsPageComponent, title: 'Cards · per-client report' },
  { path: 'client/:id', component: ClientDetailComponent, title: 'Cards · client' },
  { path: '**', redirectTo: '' },
];
