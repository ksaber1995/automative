import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { TranslateModule } from '@ngx-translate/core';
import { WaNavComponent } from '../wa-nav/wa-nav.component';
import { WhatsappService, WaConversation, WaMessage } from '../services/whatsapp.service';

@Component({
  selector: 'app-wa-inbox',
  standalone: true,
  imports: [CommonModule, CardModule, TranslateModule, WaNavComponent],
  templateUrl: './wa-inbox.component.html',
})
export class WaInboxComponent implements OnInit {
  private wa = inject(WhatsappService);

  loading = signal(true);
  conversations = signal<WaConversation[]>([]);
  selected = signal<WaConversation | null>(null);
  messages = signal<WaMessage[]>([]);
  messagesLoading = signal(false);

  ngOnInit() {
    this.wa.listConversations().subscribe({
      next: (rows) => { this.conversations.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  select(c: WaConversation) {
    this.selected.set(c);
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
}
