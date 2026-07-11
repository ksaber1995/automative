import { Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
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
import { renderCardBackPng } from '../students/card-back.util';

/**
 * Settings > Card Design — edits the SHARED back face of the printed student ID
 * cards (teacher details, rules, contacts, slogan, info QR). The front face is
 * per-student and generated from student data; nothing here affects it.
 *
 * Saved design is exported as a single `card-back.png` at the root of the
 * students ZIP.
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

  loading = signal(true);
  saving = signal(false);
  downloading = signal(false);
  design = signal<CardDesign>({ ...DEFAULT_CARD_DESIGN });

  readonly maxInstructions = CARD_DESIGN_MAX.instructions;
  readonly maxHighlights = CARD_DESIGN_MAX.highlights;

  ngOnInit() {
    this.companyService.getCardDesign().subscribe({
      next: (d) => {
        this.design.set(this.pad(d));
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
      const canvas = this.previewCanvas?.nativeElement;
      if (!canvas) return;
      try {
        await renderCardBackPng(this.design(), canvas);
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

  save() {
    this.saving.set(true);
    // Drop the empty slots the form pads out; the server re-applies defaults.
    const d = this.design();
    const payload: CardDesign = {
      ...d,
      instructions: d.instructions.map((s) => s.trim()).filter(Boolean),
      highlights: d.highlights.map((s) => s.trim()).filter(Boolean),
    };
    this.companyService.updateCardDesign(payload).subscribe({
      next: (saved) => {
        this.design.set(this.pad(saved));
        this.notificationService.success(this.translate.instant('CARD_DESIGN.SAVED'));
        this.saving.set(false);
        this.redraw();
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }
}
