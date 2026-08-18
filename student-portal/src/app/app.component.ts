import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { I18nService } from './i18n.service';
import { StudentAuthService } from './auth/student-auth.service';

/**
 * The shell: brand strip with the language toggle, then whatever screen the
 * router picked. No sidebar, no session gate here — the welcome screen IS the
 * signed-out state, and the guards handle the rest.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <div class="page">
      <div class="topbar">
        <span class="brand">{{ i18n.t('APP.TITLE') }}</span>
        <button type="button" (click)="i18n.toggle()">{{ i18n.t('APP.LANG_TOGGLE') }}</button>
      </div>
      <router-outlet />
    </div>
  `,
})
export class AppComponent {
  i18n = inject(I18nService);
  private auth = inject(StudentAuthService);

  constructor() {
    this.auth.restore();
  }
}
