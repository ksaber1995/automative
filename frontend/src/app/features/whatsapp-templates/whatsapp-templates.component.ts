import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WhatsappTemplatesService } from '../../core/services/whatsapp-templates.service';
import { NotificationService } from '../../core/services/notification.service';
import { AuthService } from '../../core/services/auth.service';
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  WHATSAPP_TEMPLATE_TYPES,
  WhatsappTemplateType,
  templateVarLabel,
} from '../../core/utils/whatsapp.util';

interface TemplateDef {
  type: WhatsappTemplateType;
  /** Placeholder tokens that are available for this template. */
  placeholders: string[];
}

@Component({
  selector: 'app-whatsapp-templates',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, TranslateModule],
  templateUrl: './whatsapp-templates.component.html',
})
export class WhatsappTemplatesComponent implements OnInit {
  private templatesSvc = inject(WhatsappTemplatesService);
  private notification = inject(NotificationService);
  private translate = inject(TranslateService);
  private auth = inject(AuthService);

  /**
   * The chips are named in the tenant's own vocabulary — a coach is offered
   * {traineeName}, not {studentName}. Both substitute, so a body written either
   * way renders (see SPORTS_TEMPLATE_ALIASES).
   */
  protected varLabel(canonical: string): string {
    return templateVarLabel(canonical, this.auth.vertical() === 'SPORTS');
  }

  readonly defs: TemplateDef[] = [
    { type: 'QR_STUDENT', placeholders: ['studentName', 'academyName', 'link', 'code'] },
    { type: 'FOLLOWUP_PARENT', placeholders: ['studentName', 'parentName', 'academyName', 'link'] },
    { type: 'ABSENCE', placeholders: ['studentName', 'parentName', 'academyName', 'className', 'courseName', 'sessionNumber', 'date'] },
    { type: 'PAYMENT_DELAY', placeholders: ['studentName', 'academyName', 'amount', 'currency', 'courseName', 'dueDate'] },
    { type: 'EXAM_RESULTS', placeholders: ['studentName', 'parentName', 'academyName', 'examName', 'grade', 'maxGrade', 'percentage', 'courseName'] },
  ];

  /** Editable bodies keyed by template type. */
  bodies: Record<string, string> = {};
  loading = signal(true);
  saving = signal(false);

  ngOnInit(): void {
    this.templatesSvc.load().subscribe({
      next: (templates) => {
        for (const type of WHATSAPP_TEMPLATE_TYPES) {
          this.bodies[type] = templates[type] ?? DEFAULT_WHATSAPP_TEMPLATES[type];
        }
        this.loading.set(false);
      },
      error: () => {
        for (const type of WHATSAPP_TEMPLATE_TYPES) {
          this.bodies[type] = DEFAULT_WHATSAPP_TEMPLATES[type];
        }
        this.loading.set(false);
      },
    });
  }

  resetToDefault(type: WhatsappTemplateType): void {
    this.bodies[type] = DEFAULT_WHATSAPP_TEMPLATES[type];
  }

  save(): void {
    this.saving.set(true);
    this.templatesSvc.update({ ...this.bodies }).subscribe({
      next: () => {
        this.notification.success(this.translate.instant('WHATSAPP_TEMPLATES.SAVED'));
        this.saving.set(false);
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }
}
