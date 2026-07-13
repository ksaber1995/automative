import { Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { saveAs } from 'file-saver';
import { CardDesign, CARD_DESIGN_MAX, DEFAULT_CARD_DESIGN } from '@shared/interfaces/card-design.interface';
import { CompanyService } from '../../core/services/company.service';
import { NotificationService } from '../../core/services/notification.service';
import {
  StudentCardData, currentAcademicYear, renderCardBackPng, renderStudentCardPng,
} from '../students/card-render.util';
import { CARD_TEMPLATES, CardTemplate } from '../students/card-theme';

/**
 * Settings > Card Design.
 *
 * Two things live here:
 *  - the TEMPLATE, which governs BOTH faces of every printed card;
 *  - the content of the shared BACK face (teacher details, rules, contacts,
 *    slogan, info QR), which is identical for every student.
 *
 * The FRONT face is per-student and generated from student data, so it is not
 * editable — but it follows the chosen template, and the preview renders it from
 * sample data so you can see exactly what the students will get.
 *
 * On export: one front per student per class, plus a single shared
 * `card-back.png` at the root of the students ZIP.
 */
@Component({
  selector: 'app-card-design',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, InputTextModule, TextareaModule, TranslateModule],
  templateUrl: './card-design.component.html',
})
export class CardDesignComponent implements OnInit {
  private companyService = inject(CompanyService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);

  @ViewChild('preview') previewCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewFront') previewFrontCanvas?: ElementRef<HTMLCanvasElement>;

  loading = signal(true);
  saving = signal(false);
  savingTemplate = signal(false);
  downloading = signal(false);
  design = signal<CardDesign>({ ...DEFAULT_CARD_DESIGN });
  /** Last design the server confirmed — the base for a template-only save. */
  savedDesign = signal<CardDesign | null>(null);
  /** The chosen template differs from what's stored, so it's worth saving. */
  templateDirty = computed(() => {
    const saved = this.savedDesign();
    return !!saved && saved.template !== this.design().template;
  });

  readonly templates = CARD_TEMPLATES;
  readonly maxInstructions = CARD_DESIGN_MAX.instructions;
  readonly maxHighlights = CARD_DESIGN_MAX.highlights;

  ngOnInit() {
    this.companyService.getCardDesign().subscribe({
      next: (d) => {
        this.design.set(this.pad(d));
        this.savedDesign.set(d);
        this.loading.set(false);
        this.redraw();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
        this.redraw();
      },
    });
  }

  /**
   * Stand-in student for the front-face preview. The real fronts are built from
   * each student's own record at export time; this only shows the look and feel.
   */
  private sampleStudent(): StudentCardData {
    return {
      companyName: this.design().teacherName || '',
      name: this.translate.instant('CARD_DESIGN.SAMPLE_NAME'),
      code: '#1024',
      level: this.translate.instant('CARD_DESIGN.SAMPLE_LEVEL'),
      group: this.translate.instant('CARD_DESIGN.SAMPLE_GROUP'),
      year: currentAcademicYear(),
      subject: this.translate.instant('CARD_DESIGN.SAMPLE_SUBJECT'),
      qrUrl: `${window.location.origin}/p/s/preview`,
    };
  }

  /** Pad the lists to their max so the form always shows every editable slot. */
  private pad(d: CardDesign): CardDesign {
    const fill = (arr: string[], n: number) =>
      Array.from({ length: n }, (_, i) => arr[i] ?? '');
    return {
      ...d,
      instructions: fill(d.instructions || [], this.maxInstructions),
      highlights: fill(d.highlights || [], this.maxHighlights),
    };
  }

  /** Any field edit -> patch the model and repaint the preview. */
  set<K extends keyof CardDesign>(key: K, value: CardDesign[K]) {
    this.design.update((d) => ({ ...d, [key]: value }));
    this.redraw();
  }

  setListItem(key: 'instructions' | 'highlights', index: number, value: string) {
    this.design.update((d) => {
      const list = [...d[key]];
      list[index] = value;
      return { ...d, [key]: list };
    });
    this.redraw();
  }

  private redrawPending = false;
  /** Repaint on the next frame — typing fires per keystroke and a full card is ~15ms. */
  private redraw() {
    if (this.redrawPending) return;
    this.redrawPending = true;
    requestAnimationFrame(async () => {
      this.redrawPending = false;
      const d = this.design();
      const back = this.previewCanvas?.nativeElement;
      const front = this.previewFrontCanvas?.nativeElement;
      try {
        if (back) await renderCardBackPng(d, back);
        // The student side is not editable — it is rendered from sample data so
        // you can see the look and feel the students will actually get.
        if (front) await renderStudentCardPng(this.sampleStudent(), front, d.template as CardTemplate);
      } catch {
        // A malformed QR link (e.g. mid-typing) just leaves the last good frame up.
      }
    });
  }

  /**
   * Download the back face on its own, as the print-ready PNG. Renders from the
   * CURRENT form state (not the saved copy), so what you see is what you get
   * even with unsaved edits.
   */
  async downloadPng() {
    this.downloading.set(true);
    try {
      const canvas = document.createElement('canvas');
      const base64 = await renderCardBackPng(this.design(), canvas);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      saveAs(new Blob([bytes], { type: 'image/png' }), 'card-back.png');
    } catch {
      this.notificationService.error(this.translate.instant('CARD_DESIGN.DOWNLOAD_ERROR'));
    } finally {
      this.downloading.set(false);
    }
  }

  /** Strip the empty slots the form pads out; the server re-applies defaults. */
  private payloadFrom(d: CardDesign): CardDesign {
    return {
      ...d,
      instructions: d.instructions.map((s) => s.trim()).filter(Boolean),
      highlights: d.highlights.map((s) => s.trim()).filter(Boolean),
    };
  }

  save() {
    this.saving.set(true);
    this.companyService.updateCardDesign(this.payloadFrom(this.design())).subscribe({
      next: (saved) => {
        this.design.set(this.pad(saved));
        this.savedDesign.set(saved);
        this.notificationService.success(this.translate.instant('CARD_DESIGN.SAVED'));
        this.saving.set(false);
        this.redraw();
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }

  /**
   * Save ONLY the chosen template, leaving the back-face fields as they are on the
   * server. Picking a template and hitting this shouldn't quietly commit half-typed
   * edits elsewhere on the form, so it posts the last SAVED design with just the
   * template swapped — not the current form state.
   */
  saveTemplate() {
    this.savingTemplate.set(true);
    const base = this.savedDesign() ?? this.design();
    const payload = this.payloadFrom({ ...base, template: this.design().template });
    this.companyService.updateCardDesign(payload).subscribe({
      next: (saved) => {
        this.savedDesign.set(saved);
        // Keep whatever the user is currently editing; only the template is now saved.
        this.notificationService.success(this.translate.instant('CARD_DESIGN.TEMPLATE_SAVED'));
        this.savingTemplate.set(false);
      },
      error: () => {
        this.savingTemplate.set(false);
      },
    });
  }
}
