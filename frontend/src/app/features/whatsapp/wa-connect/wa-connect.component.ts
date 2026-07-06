import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WaNavComponent } from '../wa-nav/wa-nav.component';
import { WhatsappService, WaAccount } from '../services/whatsapp.service';
import { NotificationService } from '../../../core/services/notification.service';

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
            <p-button icon="pi pi-link" [label]="'WA.CONNECT_BTN' | translate" severity="success" (onClick)="connect()"></p-button>
          }
        </p-card>
      }
    </div>
  `,
})
export class WaConnectComponent implements OnInit {
  private wa = inject(WhatsappService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);

  loading = signal(true);
  working = signal(false);
  account = signal<WaAccount | null>(null);

  ngOnInit() { this.load(); }

  private load() {
    this.loading.set(true);
    this.wa.getAccount().subscribe({
      next: (a) => { this.account.set(a); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  connect() {
    // Foundation: Embedded Signup launches once the Meta app is configured (Part 1).
    this.notify.warning(this.translate.instant('WA.CONNECT_PENDING'));
  }

  disconnect() {
    this.working.set(true);
    this.wa.disconnect().subscribe({
      next: () => { this.working.set(false); this.notify.success(this.translate.instant('WA.DISCONNECTED')); this.load(); },
      error: () => this.working.set(false),
    });
  }
}
