import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SubscriptionsService } from '../subscriptions.service';
import { PortalAuthService } from '../auth/portal-auth.service';
import { AdminStore } from '../admin-store.service';

/**
 * The platform-owned Telegram bot pool. Academies auto-claim a free bot when
 * they switch Telegram on, so the job here is keeping spare bots in the pool.
 */
@Component({
  selector: 'app-bots-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../shared/admin-ui.css'],
  template: `
    <header>
      <div>
        <h1>Telegram bots</h1>
        <p class="sub">
          {{ poolAvailable() }} available · {{ poolTotal() }} total — create bots in &#64;BotFather,
          paste each token here.
        </p>
      </div>
      <button class="refresh" (click)="refresh()">Refresh</button>
    </header>

    <div class="card" style="margin: 20px 0; padding: 16px;">
      @if (auth.can('bots.write')) {
        <div style="display:flex; gap:8px; max-width:560px;">
          <input class="search" type="text"
            [ngModel]="poolToken()" (ngModelChange)="poolToken.set($event)"
            placeholder="Paste a bot token from @BotFather…" />
          <button class="act activate" [disabled]="addingBot() || !poolToken().trim()" (click)="addBot()">
            {{ addingBot() ? 'Adding…' : 'Add bot' }}
          </button>
        </div>
      }

      @if (bots().length) {
        <div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px;">
          @for (b of bots(); track b.id) {
            <span class="reg" [class.academy]="!b.assigned_company_id" [class.teacher]="b.assigned_company_id">
              {{ '@' + b.bot_username }} · {{ b.company_name || 'available' }}
            </span>
          }
        </div>
      } @else {
        <div class="state">No bots in the pool.</div>
      }
    </div>
  `,
})
export class BotsPageComponent {
  private service = inject(SubscriptionsService);
  private store = inject(AdminStore);
  protected auth = inject(PortalAuthService);

  protected bots = this.store.bots;
  protected poolTotal = this.store.poolTotal;
  protected poolAvailable = this.store.poolAvailable;

  protected poolToken = signal('');
  protected addingBot = signal(false);

  constructor() {
    this.store.loadBots();
  }

  protected refresh(): void {
    this.store.loadBots(true);
  }

  protected addBot(): void {
    const token = this.poolToken().trim();
    if (!token || this.addingBot()) return;
    this.addingBot.set(true);
    this.service.addTelegramBot(token).subscribe({
      next: (res) => {
        this.addingBot.set(false);
        this.poolToken.set('');
        this.store.showFlash(`Added @${res.bot_username} · ${res.available} available`);
        this.store.loadBots(true);
      },
      error: (err) => {
        this.addingBot.set(false);
        this.store.showFlash(err?.error?.message || 'Could not add bot');
      },
    });
  }
}
