import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { WaNavComponent } from '../wa-nav/wa-nav.component';
import { WhatsappService, WaAccount } from '../services/whatsapp.service';
import { NotificationService } from '../../../core/services/notification.service';

// Meta's JS SDK is loaded on demand at runtime, so it has no types here.
declare const FB: any;
declare global {
  interface Window { fbAsyncInit?: () => void; FB?: any; }
}

@Component({
  selector: 'app-wa-connect',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, TagModule, TranslateModule, WaNavComponent],
  template: `
    <div class="p-4">
      <app-wa-nav></app-wa-nav>
      <div class="mb-4">
        <h1 class="text-2xl font-bold text-gray-800">{{ 'WA.CONNECT_TITLE' | translate }}</h1>
        <p class="text-sm text-gray-500">{{ 'WA.CONNECT_SUBTITLE' | translate }}</p>
      </div>

      @if (loading()) {
        <div class="text-center text-gray-400 py-10"><i class="pi pi-spin pi-spinner text-2xl"></i></div>
      } @else if (account(); as a) {
        <p-card>
          <div class="flex items-center gap-3 mb-4">
            <i class="pi pi-whatsapp text-3xl text-green-500"></i>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-semibold text-gray-800">{{ 'WA.STATUS' | translate }}</span>
                <p-tag [value]="('WA.ST_' + a.status) | translate" [severity]="a.status === 'ACTIVE' ? 'success' : (a.status === 'ERROR' ? 'danger' : 'secondary')"></p-tag>
              </div>
              @if (a.displayPhoneNumber) { <div class="text-sm text-gray-600 mt-1">{{ a.verifiedName }} · {{ a.displayPhoneNumber }}</div> }
            </div>
          </div>

          @if (a.status === 'ACTIVE') {
            <div class="text-sm text-gray-600 mb-3">
              {{ 'WA.QUALITY' | translate }}: <strong>{{ a.qualityRating || '—' }}</strong>
            </div>
            <p-button icon="pi pi-times" [label]="'WA.DISCONNECT' | translate" severity="danger" [outlined]="true" (onClick)="disconnect()" [loading]="working()"></p-button>
          } @else {
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
              <i class="pi pi-info-circle"></i> {{ 'WA.CONNECT_HINT' | translate }}
            </div>
            <p-button icon="pi pi-link" [label]="'WA.CONNECT_BTN' | translate" severity="success" (onClick)="connect()" [loading]="working()"></p-button>
          }
        </p-card>
      }
    </div>
  `,
})
export class WaConnectComponent implements OnInit, OnDestroy {
  private wa = inject(WhatsappService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);

  loading = signal(true);
  working = signal(false);
  account = signal<WaAccount | null>(null);

  /**
   * Meta posts the chosen WABA and phone number to the opener as the dialog runs,
   * separately from the code that comes back in the login callback. Captured here
   * and passed on, though the API re-checks the WABA against the token rather
   * than trusting it.
   */
  private signupInfo: { wabaId?: string; phoneNumberId?: string } = {};
  private messageListener?: (event: MessageEvent) => void;

  ngOnInit() { this.load(); }

  ngOnDestroy() {
    if (this.messageListener) window.removeEventListener('message', this.messageListener);
  }

  private load() {
    this.loading.set(true);
    this.wa.getAccount().subscribe({
      next: (a) => { this.account.set(a); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  /**
   * Load Meta's JS SDK on demand rather than in index.html — every tenant would
   * otherwise pay for a third-party script on every page load to support a
   * feature almost none of them have switched on.
   */
  private loadFacebookSdk(appId: string, graphVersion: string): Promise<void> {
    if (window.FB) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      window.fbAsyncInit = () => {
        FB.init({ appId, cookie: true, xfbml: false, version: graphVersion });
        resolve();
      };
      const script = document.createElement('script');
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.onerror = () => reject(new Error('Failed to load the Facebook SDK'));
      document.body.appendChild(script);
    });
  }

  private listenForSignupInfo() {
    if (this.messageListener) return;
    this.messageListener = (event: MessageEvent) => {
      // Only Meta's own origins are trusted — any page can post to this window.
      if (!/^https:\/\/(www\.)?facebook\.com$/.test(event.origin)) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP' && data?.event === 'FINISH') {
          this.signupInfo = {
            wabaId: data?.data?.waba_id,
            phoneNumberId: data?.data?.phone_number_id,
          };
        }
      } catch {
        // Not JSON, or not ours — other Meta widgets post here too.
      }
    };
    window.addEventListener('message', this.messageListener);
  }

  async connect() {
    this.working.set(true);
    try {
      const config = await firstValueFrom(this.wa.connectStart());
      await this.loadFacebookSdk(config.appId, config.graphVersion);
      this.listenForSignupInfo();

      const authResponse: any = await new Promise((resolve) => {
        FB.login((response: any) => resolve(response?.authResponse), {
          config_id: config.configId,
          // Ask for a code to exchange server-side; the default implicit flow
          // would hand the browser a token, which must never touch the client.
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
        });
      });

      if (!authResponse?.code) {
        // The tenant closed the dialog or declined — not an error worth shouting about.
        this.working.set(false);
        return;
      }

      const account = await firstValueFrom(this.wa.connectComplete({
        code: authResponse.code,
        wabaId: this.signupInfo.wabaId,
        phoneNumberId: this.signupInfo.phoneNumberId,
      }));
      this.account.set(account);
      this.working.set(false);
      this.notify.success(this.translate.instant('WA.CONNECTED'));
    } catch (error: any) {
      this.working.set(false);
      const message = error?.error?.message || error?.message || this.translate.instant('WA.CONNECT_FAILED');
      this.notify.error(message);
    }
  }

  disconnect() {
    this.working.set(true);
    this.wa.disconnect().subscribe({
      next: () => { this.working.set(false); this.notify.success(this.translate.instant('WA.DISCONNECTED')); this.load(); },
      error: () => this.working.set(false),
    });
  }
}
