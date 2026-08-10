import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { saveAs } from 'file-saver';
import {
  CardAdjust, CardDesign, CardFields, CARD_ADJUST_BOUNDS, CARD_DESIGN_MAX, DEFAULT_CARD_ADJUST,
  DEFAULT_CARD_DESIGN, DEFAULT_POOL_ART, POOL_ART_SAFE, PoolArtLayout, clampFields, clampPoolArt,
} from '@shared/interfaces/card-design.interface';
import { CompanyService } from '../../core/services/company.service';
import { NotificationService } from '../../core/services/notification.service';
import {
  DESIGN_H, DESIGN_W, StudentCardData, canExportCustom, currentAcademicYear, loadCardImages,
  renderAgnosticCardPng, renderStudentCardPng,
} from '../students/card-render.util';
import { CARD_TEMPLATES, CardTemplate } from '../students/card-theme';
import { AGNOSTIC_TEMPLATES, AgnosticTemplate, DEFAULT_AGNOSTIC } from '../students/card-agnostic.util';

/** Every image an academy can upload for its cards. */
type ImageKind = 'photo' | 'logo' | 'artFront' | 'artBack';

/**
 * Which tuning record a control writes to.
 *
 * The pool has TWO, one per face: both pool faces carry a logo, so a single record
 * moved both at once. Colours still live on `pool` alone and apply to both faces —
 * they are two sides of one card. See composeAdjust in the shared interface.
 */
type AdjustKey = 'student' | 'pool' | 'poolBack';

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
  imports: [CommonModule, FormsModule, CardModule, TabsModule, TooltipModule, ButtonModule, InputTextModule, TextareaModule, TranslateModule],
  templateUrl: './card-design.component.html',
  // The section panels lose their outline on this page only.
  //
  // This screen is about looking at a card, and five outlined boxes around the
  // thing you are judging compete with it — the eye reads the page's frames
  // before the card's own edges. A soft shadow still separates each section from
  // the background, so the grouping survives without the ruled lines.
  //
  // ::ng-deep because .p-card is PrimeNG's own element, outside this component's
  // emulated encapsulation. Scoped under :host, so it cannot leak to the p-cards
  // on any other screen.
  styles: [`
    :host ::ng-deep .p-card {
      border: none;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 1px 10px rgba(15, 23, 42, .04);
    }
  `],
})
export class CardDesignComponent implements OnInit, OnDestroy {
  private companyService = inject(CompanyService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  @ViewChild('previewFront') previewFrontCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewPoolFront') previewPoolFrontCanvas?: ElementRef<HTMLCanvasElement>;

  loading = signal(true);
  saving = signal(false);
  savingTemplate = signal(false);
  design = signal<CardDesign>({ ...DEFAULT_CARD_DESIGN });
  /** Last design the server confirmed — the base for a template-only save. */
  savedDesign = signal<CardDesign | null>(null);
  /**
   * The template OR the row checkboxes differ from what's stored, so this block
   * is worth saving. Both share one Save button, so both have to make it dirty —
   * otherwise ticking a checkbox leaves the button looking like there is nothing
   * to save and the change is lost on navigation.
   */
  templateDirty = computed(() => {
    const saved = this.savedDesign();
    if (!saved) return false;
    if (saved.template !== this.design().template) return true;
    const a = clampFields(saved.fields);
    const b = clampFields(this.design().fields);
    return (Object.keys(a) as (keyof CardFields)[]).some((k) => a[k] !== b[k]);
  });

  readonly templates = CARD_TEMPLATES;

  /**
   * Which tab is open. The pool's canvases only exist while its panel is mounted,
   * so switching to it has to repaint them — redraw() is a no-op for a canvas that
   * isn't in the DOM, and the panel renders one tick after the value changes.
   */
  // Mirrored into ?tab= so a refresh lands back where you were, and so the tab can
  // be linked to. Read once on init rather than subscribed: nothing outside this
  // component changes the tab, and a subscription would fight setTab's own write.
  activeTab = signal<'students' | 'pool'>('students');
  setTab(v: string): void {
    const tab = v === 'pool' ? 'pool' : 'students';
    this.activeTab.set(tab);
    // replaceUrl: a tab is a view preference, not a place. Pushing history would
    // make Back walk through every tab you clicked instead of leaving the page.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      replaceUrl: true,
    });
    setTimeout(() => this.redraw());
  }
  readonly agnosticTemplates = AGNOSTIC_TEMPLATES;

  /** The pool template in force — the design may predate the field. */
  agnostic = computed<AgnosticTemplate>(() => (this.design().agnosticTemplate as AgnosticTemplate) ?? DEFAULT_AGNOSTIC);
  /** Which pool template is being persisted — picking one saves it, no Save click. */
  savingAgnostic = signal(false);
  readonly maxInstructions = CARD_DESIGN_MAX.instructions;
  readonly maxHighlights = CARD_DESIGN_MAX.highlights;

  // ── Logo / photo placement + colours ────────────────────────────────────────
  // Held separately per card set: the pool cards and the student cards are
  // different designs printed for different reasons, so one shared offset would be
  // wrong on one of them. `which` is the tab the control belongs to.
  readonly bounds = CARD_ADJUST_BOUNDS;

  /**
   * The three colour roles a tenant can set, and the swatch the picker shows while a
   * role is still "as designed". The fallbacks are display-only — a BLANK value is
   * what reaches the renderer, and blank is what makes it keep the template's own.
   */
  readonly colorFields: { key: 'bg' | 'text' | 'accent'; label: string; fallback: string }[] = [
    { key: 'bg', label: 'CARD_DESIGN.TUNE_BG', fallback: '#141d55' },
    { key: 'text', label: 'CARD_DESIGN.TUNE_TEXT', fallback: '#111827' },
    { key: 'accent', label: 'CARD_DESIGN.TUNE_ACCENT', fallback: '#c9992f' },
  ];

  adjust(which: AdjustKey): CardAdjust {
    return this.design()[which] ?? DEFAULT_CARD_ADJUST;
  }

  setAdjust<K extends keyof CardAdjust>(which: AdjustKey, key: K, value: CardAdjust[K]): void {
    this.design.update((d) => ({
      ...d,
      [which]: { ...DEFAULT_CARD_ADJUST, ...(d[which] ?? {}), [key]: value },
    }));
    this.redraw();
    // The pool's two tuners sit on a tab with no Save button, so they persist
    // themselves. `student` sits on the students tab, where the Save button is the
    // save — auto-saving it there would commit edits the user hasn't hit Save on.
    if (which !== 'student') this.queuePoolSave();
  }

  /** Sliders hand back strings; a NaN would poison the stored design. */
  setAdjustNum(which: AdjustKey, key: 'logoScale' | 'logoDx' | 'logoDy' | 'photoDx' | 'photoDy', value: unknown): void {
    const n = Number(value);
    this.setAdjust(which, key, Number.isFinite(n) ? n : DEFAULT_CARD_ADJUST[key]);
  }

  /**
   * A colour input can never be empty — it reports '#000000' when cleared — so
   * "use the template's own" needs its own explicit control, not a blank value.
   */
  clearColor(which: AdjustKey, key: 'bg' | 'text' | 'accent'): void {
    this.setAdjust(which, key, '');
  }

  /** The swatch needs SOME value to show; the template's own is what blank means. */
  colorOr(which: AdjustKey, key: 'bg' | 'text' | 'accent', fallback: string): string {
    return this.adjust(which)[key] || fallback;
  }

  hasAnyAdjust(which: AdjustKey): boolean {
    const a = this.adjust(which);
    return a.logoScale !== 100 || !!a.logoDx || !!a.logoDy || !!a.photoDx || !!a.photoDy
      || !!a.bg || !!a.text || !!a.accent;
  }

  resetAdjust(which: AdjustKey): void {
    this.design.update((d) => ({ ...d, [which]: { ...DEFAULT_CARD_ADJUST } }));
    this.redraw();
    if (which !== 'student') this.savePoolFacets();
  }

  ngOnInit() {
    // Restore the tab before the first paint, so a refresh lands where you were.
    if (this.route.snapshot.queryParamMap.get('tab') === 'pool') this.activeTab.set('pool');

    this.companyService.getCardDesign().subscribe({
      next: (d) => {
        this.design.set(this.pad(d));
        this.savedDesign.set(d);
        this.loading.set(false);
        this.paint();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
        this.paint();
      },
    });
  }

  ngOnDestroy(): void {
    // Leaving within the debounce window must still land the change: there is no
    // Save button on this tab to fall back on, and the request outlives the
    // component. Without this the fix would only make the loss less frequent.
    if (this.poolSaveTimer) this.savePoolFacets();
  }

  /**
   * First paint after the design lands.
   *
   * The tab panels only exist once `loading` is false, and the pool's panel renders
   * a tick after that — the same reason setTab defers. redraw() is a no-op for a
   * canvas that is not in the DOM yet, so a refresh straight onto ?tab=pool would
   * paint nothing and leave two blank cards. Draw now for the students tab, and
   * again next tick for whichever panel has just mounted.
   */
  private paint(): void {
    this.redraw();
    setTimeout(() => this.redraw());
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
      // Shown in the preview so the designer sees the densest layout a real card
      // can reach — a card with a school has one more row than one without.
      school: this.translate.instant('CARD_DESIGN.SAMPLE_SCHOOL'),
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
      // Every design saved before these existed has neither, and the form binds
      // straight onto their fields — an absent block would blow up on first paint.
      student: { ...DEFAULT_CARD_ADJUST, ...(d.student ?? {}) },
      pool: { ...DEFAULT_CARD_ADJUST, ...(d.pool ?? {}) },
      // Seeded from `pool` when absent, matching the renderer's own fallback: a
      // design saved before the two pool faces were split placed BOTH logos with
      // `pool`, so the back's sliders have to open where its logo actually is.
      poolBack: { ...DEFAULT_CARD_ADJUST, ...(d.poolBack ?? d.pool ?? {}) },
      // Same reason as the blocks above: the checkboxes bind straight onto this,
      // and a design saved before the toggles existed has no `fields` at all.
      // Absent means every row, which is what those cards already printed.
      fields: clampFields(d.fields),
    };
  }

  /** Flip one row on or off, then repaint so the change is visible immediately. */
  toggleField(key: keyof CardFields, on: boolean): void {
    this.design.update((d) => ({ ...d, fields: { ...clampFields(d.fields), [key]: on } }));
    this.redraw();
  }

  /** The checkbox list, in the order the rows appear on the card. */
  readonly fieldToggles: { key: keyof CardFields; labelKey: string }[] = [
    { key: 'studentName', labelKey: 'CARD_DESIGN.FIELD_STUDENT_NAME' },
    { key: 'className', labelKey: 'CARD_DESIGN.FIELD_CLASS' },
    { key: 'courseName', labelKey: 'CARD_DESIGN.FIELD_COURSE' },
    { key: 'school', labelKey: 'CARD_DESIGN.FIELD_SCHOOL' },
    { key: 'year', labelKey: 'CARD_DESIGN.FIELD_YEAR' },
  ];

  /** Any field edit -> patch the model and repaint the preview. */
  set<K extends keyof CardDesign>(key: K, value: CardDesign[K]) {
    this.design.update((d) => ({ ...d, [key]: value }));
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
  // The artworks ARE the whole card, so they need the card's own resolution — the
  // print bitmap is 1063 x 673. Anything under that prints soft; much over it is
  // pixels the printer throws away in exchange for a heavier design blob.
  private readonly ART_MAX = 1300;
  uploading = signal<ImageKind | null>(null);
  /** Which image is being saved — the upload persists itself, with no Save click. */
  savingImage = signal<ImageKind | null>(null);

  async onImagePicked(kind: ImageKind, event: Event): Promise<void> {
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
      // A logo keeps its alpha (it sits on a coloured panel); a photo and a
      // full-card artwork are photographic, so JPEG saves several times the bytes.
      const max = kind === 'photo' ? this.PHOTO_MAX : kind === 'logo' ? this.LOGO_MAX : this.ART_MAX;
      const dataUrl = await this.downscale(file, max, kind === 'logo');
      this.set(kind, dataUrl);   // set() repaints the preview
      this.saveImage(kind);      // picking a file IS the intent — no Save click needed
    } catch {
      this.notificationService.error(this.translate.instant('CARD_DESIGN.IMG_FAILED'));
    } finally {
      this.uploading.set(null);
    }
  }

  removeImage(kind: ImageKind): void {
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
  private saveImage(kind: ImageKind): void {
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

  // ── The academy's own pool artwork ('custom') ───────────────────────────────

  /** True while the pool design in force is the academy's own artwork. */
  isCustomPool = computed(() => this.agnostic() === 'custom');

  /** The placement in force, clamped — a stored design may predate the field. */
  artLayout = computed<PoolArtLayout>(() => clampPoolArt(this.design().poolArt));

  /** The front artwork is required before a pool ZIP can be printed. */
  customReady = computed(() => canExportCustom(this.design()));

  /** The artwork slot(s). Pool cards are front-only, so just the front. */
  readonly artFields: { key: 'artFront' | 'artBack'; label: string }[] = [
    { key: 'artFront', label: 'CARD_DESIGN.ART_FRONT' },
  ];

  setArt<K extends keyof PoolArtLayout>(key: K, value: PoolArtLayout[K]): void {
    this.design.update((d) => ({
      ...d,
      poolArt: clampPoolArt({ ...DEFAULT_POOL_ART, ...(d.poolArt ?? {}), [key]: value }),
    }));
    this.redraw();
    // These controls ARE the decision, exactly as a drag is: this tab has no Save
    // button, so a change that only redraws is a change that never happened.
    this.queuePoolSave();
  }

  setArtNum(key: 'qrSize' | 'codeSize', value: unknown): void {
    const n = Number(value);
    this.setArt(key, Number.isFinite(n) ? n : DEFAULT_POOL_ART[key]);
  }

  resetArt(): void {
    this.design.update((d) => ({ ...d, poolArt: { ...DEFAULT_POOL_ART } }));
    this.redraw();
    this.savePoolFacets();
  }

  /**
   * Persist what the pool tab owns: both tuners and the artwork placement.
   *
   * This tab has no Save button — every control on it is its own decision, the way
   * an upload or the design picker is. It posts the last SAVED design with only
   * these three swapped, so a change here can't quietly commit half-typed back-face
   * edits sitting on the students tab.
   *
   * All three ride along on every post rather than each control sending only its
   * own field: two controls touched inside one save's round-trip would otherwise
   * each build on a `savedDesign` that predates the other, and the second would
   * reinstate the first's old value.
   */
  private poolSaveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Coalesce a burst of changes into one save.
   *
   * The colour pickers and the size sliders fire on every tick of a drag, and each
   * tick would otherwise post the whole card_design row — artwork included, which
   * is the heaviest thing this page stores. So persist once the control settles.
   */
  private queuePoolSave(): void {
    if (this.poolSaveTimer) clearTimeout(this.poolSaveTimer);
    this.poolSaveTimer = setTimeout(() => this.savePoolFacets(), 500);
  }

  private savePoolFacets(): void {
    // Any explicit save (a drag landing, a reset) supersedes a queued one; letting
    // both run would post the same row twice, the later one for no reason.
    if (this.poolSaveTimer) {
      clearTimeout(this.poolSaveTimer);
      this.poolSaveTimer = null;
    }
    const base = this.savedDesign() ?? this.design();
    const d = this.design();
    const payload = this.payloadFrom({ ...base, pool: d.pool, poolBack: d.poolBack, poolArt: d.poolArt });
    this.companyService.updateCardDesign(payload).subscribe({
      next: (saved) => this.savedDesign.set(saved),
      error: () => {
        // The interceptor toasts the reason. Put the stored values back, so what is
        // on screen is what would actually print.
        const s = this.savedDesign();
        this.design.update((x) => ({
          ...x,
          pool: s?.pool ?? { ...DEFAULT_CARD_ADJUST },
          poolBack: s?.poolBack ?? { ...DEFAULT_CARD_ADJUST },
          poolArt: s?.poolArt ?? { ...DEFAULT_POOL_ART },
        }));
        this.redraw();
      },
    });
  }

  /**
   * What the pointer is moving. Held here rather than in the DOM because a drag has
   * to survive the pointer leaving the canvas — releasing outside it must still end
   * the drag and save, or the placement silently diverges from what is stored.
   */
  private drag: 'qr' | 'qr-size' | 'code' | null = null;
  /** Grab offset, so a drag moves the object BY the pointer rather than snapping its centre to it. */
  private grabDx = 0;
  private grabDy = 0;
  /** True once a pointerdown has actually moved something worth saving. */
  private dragMoved = false;

  /** Client px -> design px. The artwork is full-bleed, so the canvas IS design space. */
  private toDesign(ev: PointerEvent): { x: number; y: number } {
    const el = this.previewPoolFrontCanvas!.nativeElement;
    const r = el.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * DESIGN_W,
      y: ((ev.clientY - r.top) / r.height) * DESIGN_H,
    };
  }

  onArtPointerDown(ev: PointerEvent): void {
    if (!this.isCustomPool()) return;
    const L = this.artLayout();
    const { x, y } = this.toDesign(ev);
    const half = L.qrSize / 2;

    // The resize handle is tested FIRST: it sits on the QR's corner, so hit-testing
    // the box first would swallow every grab of the handle.
    const hx = L.qrX + half;
    const hy = L.qrY + half;
    if (Math.abs(x - hx) <= 26 && Math.abs(y - hy) <= 26) {
      this.drag = 'qr-size';
    } else if (Math.abs(x - L.qrX) <= half && Math.abs(y - L.qrY) <= half) {
      this.drag = 'qr';
      this.grabDx = L.qrX - x;
      this.grabDy = L.qrY - y;
    } else if (Math.abs(x - L.codeX) <= L.codeSize * 3.2 && Math.abs(y - L.codeY) <= L.codeSize) {
      this.drag = 'code';
      this.grabDx = L.codeX - x;
      this.grabDy = L.codeY - y;
    } else {
      return;
    }

    this.dragMoved = false;
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  }

  onArtPointerMove(ev: PointerEvent): void {
    if (!this.drag) return;
    const { x, y } = this.toDesign(ev);
    this.dragMoved = true;

    if (this.drag === 'qr') {
      this.design.update((d) => ({
        ...d,
        poolArt: clampPoolArt({ ...this.artLayout(), qrX: x + this.grabDx, qrY: y + this.grabDy }),
      }));
    } else if (this.drag === 'qr-size') {
      // Square: the handle drives the side length off whichever axis moved further,
      // so a diagonal drag does what it looks like it should.
      const L = this.artLayout();
      const size = Math.max(Math.abs(x - L.qrX), Math.abs(y - L.qrY)) * 2;
      this.design.update((d) => ({ ...d, poolArt: clampPoolArt({ ...L, qrSize: size }) }));
    } else {
      this.design.update((d) => ({
        ...d,
        poolArt: clampPoolArt({ ...this.artLayout(), codeX: x + this.grabDx, codeY: y + this.grabDy }),
      }));
    }
    this.redraw();
    ev.preventDefault();
  }

  onArtPointerUp(ev: PointerEvent): void {
    if (!this.drag) return;
    (ev.target as Element).releasePointerCapture?.(ev.pointerId);
    const moved = this.dragMoved;
    this.drag = null;
    this.dragMoved = false;
    if (moved) this.savePoolFacets();   // a click that moved nothing is not a change
  }

  /**
   * The drag handles, painted ON TOP of the finished preview.
   *
   * Deliberately drawn here and not in the renderer: the renderer is what the
   * printer gets, and a dashed outline baked into a thousand exported PNGs is not
   * recoverable. The export calls the renderer with its own canvas and never comes
   * through here, so these marks cannot escape the editor.
   */
  private paintArtHandles(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const L = this.artLayout();

    ctx.save();
    // The renderer leaves its own transform behind; take the canvas back to design
    // space so these coordinates mean the same thing as the placement's do.
    ctx.setTransform(canvas.width / DESIGN_W, 0, 0, canvas.height / DESIGN_H, 0, 0);

    const half = L.qrSize / 2;
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 3;
    ctx.setLineDash([9, 7]);
    ctx.strokeRect(L.qrX - half, L.qrY - half, L.qrSize, L.qrSize);

    const cw = L.codeSize * 6.4;
    const chh = L.codeSize * 2;
    ctx.strokeRect(L.codeX - cw / 2, L.codeY - chh / 2, cw, chh);
    ctx.setLineDash([]);

    // The resize grip, on the QR's bottom-right corner.
    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.arc(L.qrX + half, L.qrY + half, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(L.qrX + half - 5, L.qrY + half + 2);
    ctx.lineTo(L.qrX + half + 2, L.qrY + half - 5);
    ctx.moveTo(L.qrX + half - 5, L.qrY + half + 6);
    ctx.lineTo(L.qrX + half + 6, L.qrY + half - 5);
    ctx.stroke();

    // The guillotine's margin of error — the reason the placement is clamped.
    ctx.strokeStyle = 'rgba(99,102,241,0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.strokeRect(POOL_ART_SAFE, POOL_ART_SAFE, DESIGN_W - POOL_ART_SAFE * 2, DESIGN_H - POOL_ART_SAFE * 2);
    ctx.restore();
  }

  private redrawPending = false;
  /** Repaint on the next frame — typing fires per keystroke and a full card is ~15ms. */
  private redraw() {
    if (this.redrawPending) return;
    this.redrawPending = true;
    requestAnimationFrame(async () => {
      this.redrawPending = false;
      const d = this.design();
      const front = this.previewFrontCanvas?.nativeElement;
      try {
        // The student side is not editable — it is rendered from sample data so
        // you can see the look and feel the students will actually get.
        if (front) {
          const images = await loadCardImages(d);
          await renderStudentCardPng(this.sampleStudent(), front, d.template as CardTemplate, images, d);
        }

        // The pool card is front-only. Its serial is a sample — the real ones come
        // from the pool — but everything else is exactly what gets printed.
        const poolFront = this.previewPoolFrontCanvas?.nativeElement;
        if (poolFront) {
          const images = await loadCardImages(d);
          const company = d.teacherName || '';
          await renderAgnosticCardPng(
            { companyName: company, code: 'A-100001', qrUrl: `${window.location.origin}/p/s/preview` },
            poolFront, this.agnostic(), images, d,
          );
          // AFTER the render, and only in the editor — see paintArtHandles.
          if (this.isCustomPool()) this.paintArtHandles(poolFront);
        }
      } catch {
        // A malformed QR link (e.g. mid-typing) just leaves the last good frame up.
      }
    });
  }

  /** Strip the empty slots the form pads out; the server re-applies defaults. */
  private payloadFrom(d: CardDesign): CardDesign {
    return {
      ...d,
      instructions: d.instructions.map((s) => s.trim()).filter(Boolean),
      highlights: d.highlights.map((s) => s.trim()).filter(Boolean),
      // Always a complete set. The API's resolveCardDesign() whitelists what it
      // persists, and a partial object here would come back filled with defaults
      // — i.e. every checkbox silently ticked again.
      fields: clampFields(d.fields),
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
    // The row checkboxes live in this same block and save with it. Like the
    // template itself they are posted on top of the last SAVED design, so this
    // button never commits half-typed back-face edits sitting in the form.
    const payload = this.payloadFrom({
      ...base,
      template: this.design().template,
      fields: clampFields(this.design().fields),
    });
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

  /** Which pool design is being rendered for download. */
  downloadingPool = signal<AgnosticTemplate | null>(null);

  /**
   * Both faces of one pool design, as the print-ready PNGs.
   *
   * Works on ANY of the four, not just the one in use — the point is to hold the
   * designs side by side before committing to one. The serial on the front is a
   * sample: the real cards, each with its own QR and serial, come from the QR
   * cards page. Renders from the CURRENT form state, so unsaved edits show up.
   */
  async downloadPool(t: AgnosticTemplate): Promise<void> {
    this.downloadingPool.set(t);
    try {
      const d = this.design();
      const canvas = document.createElement('canvas');
      const images = await loadCardImages(d);
      const company = d.teacherName || '';
      await document.fonts.ready;   // Arabic must shape before we rasterise

      const save = (base64: string, name: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        saveAs(new Blob([bytes], { type: 'image/png' }), name);
      };

      // `{ ...d, agnosticTemplate: t }`, not `d`: this downloads ANY design, not
      // just the one in force, and 'custom' reads its artwork off the design.
      save(await renderAgnosticCardPng(
        { companyName: company, code: 'A-100001', qrUrl: `${window.location.origin}/p/s/preview` },
        canvas, t, images, { ...d, agnosticTemplate: t },
      ), `pool-${t}-front.png`);
    } catch {
      this.notificationService.error(this.translate.instant('CARD_DESIGN.DOWNLOAD_ERROR'));
    } finally {
      this.downloadingPool.set(null);
    }
  }

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
