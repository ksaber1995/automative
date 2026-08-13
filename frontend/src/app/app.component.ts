import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { LanguageService } from './core/services/language.service';
import { AutoSessionService } from './core/services/auto-session.service';
import { AppUpdateService } from './core/services/app-update.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastModule],
  templateUrl: './app.component.html'})
export class AppComponent {
  title = 'Netrofit';
  private languageService = inject(LanguageService);
  private autoSession = inject(AutoSessionService);
  private appUpdate = inject(AppUpdateService);

  constructor() {
    // Opt-in auto start/end of sessions on schedule (server no-op unless enabled).
    this.autoSession.start();
    // Heal tabs running a stale release (cached index.html) without user action.
    this.appUpdate.start();
  }
}
