import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WaNavComponent } from '../wa-nav/wa-nav.component';
import { WhatsappService, WaConversation, WaMessage } from '../services/whatsapp.service';
import { NotificationService } from '../../../core/services/notification.service';

/** Meta's free-form window: 24h from the contact's last inbound message. */
const FREE_FORM_WINDOW_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-wa-inbox',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, TranslateModule, WaNavComponent],
  templateUrl: './wa-inbox.component.html',
})
export class WaInboxComponent implements OnInit {
  private wa = inject(WhatsappService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);

  loading = signal(true);
  conversations = signal<WaConversation[]>([]);
  selected = signal<WaConversation | null>(null);
  messages = signal<WaMessage[]>([]);
  messagesLoading = signal(false);
  sending = signal(false);
  draft = '';

  ngOnInit() {
    this.wa.listConversations().subscribe({
      next: (rows) => { this.conversations.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  /**
   * Whether free text is still allowed. The API enforces this too — this only
   * decides whether to show an input the send would reject anyway.
   */
  canReplyFreeform(): boolean {
    const lastInbound = this.selected()?.lastInboundAt;
    if (!lastInbound) return false;
    return Date.now() - new Date(lastInbound).getTime() < FREE_FORM_WINDOW_MS;
  }

  select(c: WaConversation) {
    this.selected.set(c);
    this.draft = '';
    this.messagesLoading.set(true);
    this.wa.getMessages(c.id).subscribe({
      next: (rows) => {
        this.messages.set(rows);
        this.messagesLoading.set(false);
        // Reflect read locally.
        this.conversations.update(list => list.map(x => x.id === c.id ? { ...x, unreadCount: 0 } : x));
      },
      error: () => this.messagesLoading.set(false),
    });
  }

  send() {
    const conversation = this.selected();
    const text = this.draft.trim();
    if (!conversation || !text || this.sending()) return;

    this.sending.set(true);
    this.wa.send({ to: conversation.contactPhone, text }).subscribe({
      next: (message) => {
        // Append the row the API actually recorded rather than an optimistic
        // copy: it carries the real status, and it only exists if Meta took it.
        this.messages.update(list => [...list, message]);
        this.draft = '';
        this.sending.set(false);
      },
      error: (err) => {
        this.sending.set(false);
        this.notify.error(err?.error?.message || this.translate.instant('WA.SEND_FAILED'));
      },
    });
  }
}
