import { Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TabsModule } from 'primeng/tabs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { saveAs } from 'file-saver';
import { CardDesign, CARD_DESIGN_MAX, DEFAULT_CARD_DESIGN } from '@shared/interfaces/card-design.interface';
import { CompanyService } from '../../core/services/company.service';
import { NotificationService } from '../../core/services/notification.service';
import {
  StudentCardData, currentAcademicYear, loadCardImages, renderAgnosticBackPng, renderAgnosticCardPng,
  renderCardBackPng, renderStudentCardPng,
} from '../students/card-render.util';
import { CARD_TEMPLATES, CardTemplate } from '../students/card-theme';
import { AGNOSTIC_TEMPLATES, AgnosticTemplate, DEFAULT_AGNOSTIC } from '../students/card-agnostic.util';

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
  imports: [CommonModule, FormsModule, CardModule, TabsModule, ButtonModule, InputTextModule, TextareaModule, TranslateModule],
  templateUrl: './card-design.component.html',
})
export class CardDesignComponent implements OnInit {
  private companyService = inject(CompanyService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);

  @ViewChild('preview') previewCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewFront') previewFrontCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewPoolFront') previewPoolFrontCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewPoolBack') previewPoolBackCanvas?: ElementRef<HTMLCanvasElement>;

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

  /**
   * Which tab is open. The pool's canvases only exist while its panel is mounted,
   * so switching to it has to repaint them — redraw() is a no-op for a canvas that
   * isn't in the DOM, and the panel renders one tick after the value changes.
   */
  activeTab = signal<'students' | 'pool'>('students');
  setTab(v: string): void {
    this.activeTab.set(v === 'pool' ? 'pool' : 'students');
    setTimeout(() => this.redraw());
  }
  readonly agnosticTemplates = AGNOSTIC_TEMPLATES;

  /** The pool template in force — the design may predate the field. */
  agnostic = computed<AgnosticTemplate>(() => (this.design().agnosticTemplate as AgnosticTemplate) ?? DEFAULT_AGNOSTIC);
  /** Which pool template is being persisted — picking one saves it, no Save click. */
  savingAgnostic = signal(false);
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

  // ── Photo / logo upload ─────────────────────────────────────────────────────
  // Stored as data URLs inside the card design, NOT as hosted files: the card is
  // rasterised through canvas.toDataURL(), and an image loaded from another origin
  // taints the canvas and makes that throw — the whole export would die.
  //
  // A phone photo is several megabytes, which would blow the request limit and
  // bloat every card-design read, so each upload is downscaled and re-encoded
  // here before it ever leaves the browser.
  private readonly PHOTO_MAX = 700;   // px on the long edge — the frame is ~190px wide at 300dpi
  private readonly LOGO_MAX = 400;
  uploading = signal<'photo' | 'logo' | null>(null);
  /** Which image is being saved — the upload persists itself, with no Save click. */
  savingImage = signal<'photo' | 'logo' | null>(null);

  async onImagePicked(kind: 'photo' | 'logo', event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';           // let the same file be re-picked after a remove
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.notificationService.error(this.translate.instant('CARD_DESIGN.IMG_NOT_IMAGE'));
      return;
    }

    this.uploading.set(kind);
    try {
      const dataUrl = await this.downscale(file, kind === 'photo' ? this.PHOTO_MAX : this.LOGO_MAX, kind === 'logo');
      this.set(kind, dataUrl);   // set() repaints the preview
      this.saveImage(kind);      // picking a file IS the intent — no Save click needed
    } catch {
      this.notificationService.error(this.translate.instant('CARD_DESIGN.IMG_FAILED'));
    } finally {
      this.uploading.set(null);
    }
  }

  removeImage(kind: 'photo' | 'logo'): void {
    this.set(kind, '');
    this.saveImage(kind);
  }

  /**
   * Persist JUST this image, the moment it is picked or removed — uploading a file
   * is already the decision, so there is nothing left to confirm with a Save click.
   *
   * Like saveTemplate(), it posts the last SAVED design with only this one field
   * swapped, never the live form state: an upload must not quietly commit
   * half-typed back-face edits sitting in the form next to it.
   */
  private saveImage(kind: 'photo' | 'logo'): void {
    this.savingImage.set(kind);
    const base = this.savedDesign() ?? this.design();
    const payload = this.payloadFrom({ ...base, [kind]: this.design()[kind] });

    this.companyService.updateCardDesign(payload).subscribe({
      next: (saved) => {
        this.savedDesign.set(saved);
        this.savingImage.set(null);
        this.notificationService.success(this.translate.instant('CARD_DESIGN.IMG_SAVED'));
      },
      error: () => {
        // The interceptor toasts the reason (e.g. an image over the size cap). Put
        // the previous image back, so what is on screen matches what is stored.
        this.set(kind, (this.savedDesign()?.[kind] ?? '') as string);
        this.savingImage.set(null);
      },
    });
  }

  /**
   * Downscale to `max` on the long edge and re-encode.
   *
   * A logo keeps PNG (transparency matters — a JPEG would give it a white box on
   * the navy panel); a photo becomes JPEG, which is far smaller for a photograph.
   */
  private downscale(file: File, max: number, keepAlpha: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('decode failed'));
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.round(img.naturalWidth * scale);
          const h = Math.round(img.naturalHeight * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('no 2d context'));
          ctx.drawImage(img, 0, 0, w, h);
          resolve(keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
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
        // you can see the look and feel the students will actually get. The photo
        // and logo ARE the teacher's own, so the preview shows them for real.
        if (front) {
          const images = await loadCardImages(d);
          await renderStudentCardPng(this.sampleStudent(), front, d.template as CardTemplate, images);
        }

        // The pool card, both faces. Its serial is a sample — the real ones come
        // from the pool — but everything else is exactly what gets printed.
        const poolFront = this.previewPoolFrontCanvas?.nativeElement;
        const poolBack = this.previewPoolBackCanvas?.nativeElement;
        if (poolFront || poolBack) {
          const images = await loadCardImages(d);
          const company = d.teacherName || '';
          if (poolFront) {
            await renderAgnosticCardPng(
              { companyName: company, code: 'A-100001', qrUrl: `${window.location.origin}/p/s/preview` },
              poolFront, this.agnostic(), images,
            );
          }
          if (poolBack) await renderAgnosticBackPng(d, company, poolBack, images);
        }
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

  // ── The QR-card pool's design ───────────────────────────────────────────────
  //
  // A pool card is printed before any student owns it, so it carries no student
  // data at all — both faces are about the academy. That makes it a separate
  // choice from `template`, which governs the personal student cards.

  /**
   * Pick the pool design. Persists immediately: choosing it IS the decision, and
   * like the image uploads it posts the last SAVED design with only this field
   * swapped, so it can't quietly commit half-typed edits sitting in the form.
   */
  selectAgnostic(t: AgnosticTemplate): void {
    if (this.agnostic() === t) return;
    this.set('agnosticTemplate', t);

    this.savingAgnostic.set(true);
    const base = this.savedDesign() ?? this.design();
    this.companyService.updateCardDesign(this.payloadFrom({ ...base, agnosticTemplate: t })).subscribe({
      next: (saved) => {
        this.savedDesign.set(saved);
        this.savingAgnostic.set(false);
        this.notificationService.success(this.translate.instant('CARD_DESIGN.AGNOSTIC_SAVED'));
      },
      error: () => {
        // Put the stored choice back, so what's on screen matches what's stored.
        this.set('agnosticTemplate', (this.savedDesign()?.agnosticTemplate as AgnosticTemplate) ?? DEFAULT_AGNOSTIC);
        this.savingAgnostic.set(false);
      },
    });
  }
}
