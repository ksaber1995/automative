import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WaNavComponent } from '../wa-nav/wa-nav.component';
import { WhatsappService, WA_TEMPLATE_KEYS, WA_MARKETING_KEYS } from '../services/whatsapp.service';
import { NotificationService } from '../../../core/services/notification.service';

interface TplForm { metaTemplateName: string; body: string; category: string; }

@Component({
  selector: 'app-wa-templates',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, TagModule, InputTextModule, TextareaModule, TranslateModule, WaNavComponent],
  templateUrl: './wa-templates.component.html',
})
export class WaTemplatesComponent implements OnInit {
  private wa = inject(WhatsappService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);

  loading = signal(true);
  savingKey = signal<string | null>(null);
  readonly keys = WA_TEMPLATE_KEYS;
  forms: Record<string, TplForm> = {};

  ngOnInit() {
    for (const k of this.keys) {
      this.forms[k] = { metaTemplateName: '', body: '', category: WA_MARKETING_KEYS.includes(k) ? 'MARKETING' : 'UTILITY' };
    }
    this.wa.listTemplates().subscribe({
      next: (rows) => {
        for (const r of rows) {
          if (this.forms[r.key]) this.forms[r.key] = { metaTemplateName: r.metaTemplateName || '', body: r.body || '', category: r.category || this.forms[r.key].category };
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  keyLabel(k: string): string { return this.translate.instant('WA.TPL_' + k); }
  isMarketing(k: string): boolean { return WA_MARKETING_KEYS.includes(k); }

  save(key: string) {
    const f = this.forms[key];
    this.savingKey.set(key);
    this.wa.upsertTemplate(key, { metaTemplateName: f.metaTemplateName || null, category: f.category, body: f.body }).subscribe({
      next: () => { this.savingKey.set(null); this.notify.success(this.translate.instant('WA.TPL_SAVED')); },
      error: () => this.savingKey.set(null),
    });
  }
}
