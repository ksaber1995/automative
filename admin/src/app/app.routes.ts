import { Routes, Router, CanActivateFn, UrlTree } from '@angular/router';
import { inject } from '@angular/core';
import { PortalAuthService } from './auth/portal-auth.service';
import { CompaniesPageComponent } from './companies/companies-page.component';
import { TenantUsersPageComponent } from './tenant-users/tenant-users-page.component';
import { CardsPageComponent } from './cards/cards-page.component';
import { BotsPageComponent } from './bots/bots-page.component';
import { QrGeneratorComponent } from './qr-generator.component';
import { PortalUsersComponent } from './portal-users/portal-users.component';

/**
 * Every section, in sidebar order, with the permission that opens it.
 *
 * The order matters twice: it is the order the sidebar renders, and the first
 * entry a given account is allowed into is where `''` lands them. Defaulting to
 * Companies instead would strand anyone who was only granted Cards on a page
 * they are not allowed to see.
 */
export const SECTIONS = [
  // read_trial opens the same section; the API then only serves TRIAL tenants.
  { path: 'companies', label: 'Companies', permission: ['companies.read', 'companies.read_trial'] },
  { path: 'users', label: 'Users', permission: 'tenant_users.read' },
  { path: 'cards', label: 'Cards', permission: 'cards.read' },
  { path: 'bots', label: 'Telegram bots', permission: 'bots.read' },
  // No permission: it renders images from text typed into the page and reads
  // nothing from the API.
  { path: 'qr', label: 'QR generator', permission: null },
  { path: 'portal-users', label: 'Portal users', permission: 'portal_users.read' },
] as const;

/** The first section this account may open — where `''` and a refused route go. */
export function firstAllowedPath(auth: PortalAuthService): string {
  const section = SECTIONS.find((s) => !s.permission || auth.can(s.permission));
  return section ? `/${section.path}` : '/qr';
}

/**
 * Keep a URL nobody typed by hand out of a section its owner cannot use.
 *
 * Deliberately permissive while signed out: the shell renders the login page
 * instead of the outlet, so there is nothing to protect yet and redirecting here
 * would only fight the router. The check that matters happens again once a user
 * appears — see the effect in AppComponent — and a third time on the server,
 * which is the one that counts.
 */
export const sectionGuard: CanActivateFn = (route): boolean | UrlTree => {
  const auth = inject(PortalAuthService);
  const router = inject(Router);

  if (!auth.signedIn()) return true;

  const needed = route.data?.['permission'] as string | string[] | undefined;
  if (!needed || auth.can(needed)) return true;
  return router.parseUrl(firstAllowedPath(auth));
};

export const routes: Routes = [
  {
    path: 'companies',
    component: CompaniesPageComponent,
    title: 'Companies · Netrofit Admin',
    canActivate: [sectionGuard],
    data: { permission: ['companies.read', 'companies.read_trial'] },
  },
  {
    path: 'users',
    component: TenantUsersPageComponent,
    title: 'Users · Netrofit Admin',
    canActivate: [sectionGuard],
    data: { permission: 'tenant_users.read' },
  },
  {
    // The client sheet is `?client=<id>` rather than a child route on purpose:
    // a query parameter changes without tearing the component down, so opening
    // and closing a client does not re-fetch the whole report — and the URL is
    // still something you can reload or paste to a colleague.
    path: 'cards',
    component: CardsPageComponent,
    title: 'Cards · Netrofit Admin',
    canActivate: [sectionGuard],
    data: { permission: 'cards.read' },
  },
  {
    path: 'bots',
    component: BotsPageComponent,
    title: 'Telegram bots · Netrofit Admin',
    canActivate: [sectionGuard],
    data: { permission: 'bots.read' },
  },
  {
    path: 'qr',
    component: QrGeneratorComponent,
    title: 'QR generator · Netrofit Admin',
  },
  {
    path: 'portal-users',
    component: PortalUsersComponent,
    title: 'Portal users · Netrofit Admin',
    canActivate: [sectionGuard],
    data: { permission: 'portal_users.read' },
  },
  // `''` aims at Companies, and the guard bounces anyone without
  // `companies.read` on to the first section they DO hold. Where that lands
  // cannot be decided here: at boot the session has not resolved yet, so
  // AppComponent re-checks the landing URL the moment a user appears.
  { path: '', redirectTo: 'companies', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];
