import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import QRCode from 'qrcode';

/** One input line, once we've tried to encode it. */
interface GeneratedCode {
  text: string;
  /** PNG data URL, or '' when this line failed to encode. */
  png: string;
  /** Why this line produced no code (too long for the chosen correction level, usually). */
  error: string;
}

type ErrorLevel = 'L' | 'M' | 'Q' | 'H';

/**
 * Static QR generator — text in, printable codes out.
 *
 * Deliberately nothing to do with the card pool next door: those codes are rows
 * in `qr_cards` that a student gets linked to. These are throwaway images for
 * whatever needs one — a WhatsApp link on a flyer, a registration URL on a
 * banner — so nothing here is written to the database.
 */
@Component({
  selector: 'app-qr-generator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <header>
      <div>
        <h1>QR generator</h1>
        <p class="sub">
          One line = one code. Nothing is saved — these are plain images, not card-pool codes.
        </p>
      </div>
      <button class="refresh" (click)="generate()" [disabled]="busy()">
        {{ busy() ? 'Generating…' : 'Generate' }}
      </button>
    </header>

    <div class="card pad">
      <label class="lbl" for="qr-src">Text or URLs</label>
      <textarea
        id="qr-src"
        class="src"
        rows="6"
        spellcheck="false"
        placeholder="https://app.netrofit.com&#10;https://wa.me/201005355152&#10;Any text works"
        [(ngModel)]="source"
      ></textarea>

      <div class="opts">
        <label class="opt">
          <span>Size</span>
          <select class="search" [ngModel]="size()" (ngModelChange)="setSize($event)">
            @for (s of sizes; track s) { <option [value]="s">{{ s }} px</option> }
          </select>
        </label>

        <label class="opt">
          <span>Error correction</span>
          <select class="search" [ngModel]="level()" (ngModelChange)="setLevel($event)">
            <option value="L">L — 7% (smallest)</option>
            <option value="M">M — 15%</option>
            <option value="Q">Q — 25%</option>
            <option value="H">H — 30% (survives a logo/scuffs)</option>
          </select>
        </label>

        <label class="opt">
          <span>Quiet border</span>
          <select class="search" [ngModel]="margin()" (ngModelChange)="setMargin($event)">
            <option [value]="0">None</option>
            <option [value]="2">Normal</option>
            <option [value]="4">Wide (print-safe)</option>
          </select>
        </label>

        <label class="opt inline">
          <input type="checkbox" [ngModel]="caption()" (ngModelChange)="setCaption($event)" />
          <span>Print the text under each code</span>
        </label>
      </div>
    </div>

    @if (codes().length) {
      <div class="toolbar">
        <span class="sub">{{ okCount() }} code{{ okCount() === 1 ? '' : 's' }} ready</span>
        <span class="spacer"></span>
        <button class="act" (click)="downloadAll()" [disabled]="!okCount()">Download all PNG</button>
        <button class="act activate" (click)="printSheet()" [disabled]="!okCount()">Print sheet</button>
      </div>

      <div class="grid">
        @for (c of codes(); track c.text + $index) {
          <div class="qr card">
            @if (c.png) {
              <img [src]="c.png" [alt]="c.text" />
              <div class="qr-text" [title]="c.text">{{ c.text }}</div>
              <div class="qr-acts">
                <button class="act" (click)="downloadPng(c)">PNG</button>
                <button class="act" (click)="downloadSvg(c)">SVG</button>
              </div>
            } @else {
              <div class="qr-error">
                <strong>Couldn't encode</strong>
                <div class="qr-text" [title]="c.text">{{ c.text }}</div>
                <div class="sub">{{ c.error }}</div>
              </div>
            }
          </div>
        }
      </div>
    } @else if (touched()) {
      <p class="sub empty">Nothing to encode — type a line above.</p>
    }
  `,
  styles: [`
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 24px; }
    .sub { margin: 4px 0 0; color: #64748b; font-size: 14px; }
    .refresh {
      border: 1px solid #cbd5e1; background: #fff; color: #0f172a; border-radius: 8px;
      padding: 8px 14px; font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .refresh:hover:not(:disabled) { background: #f1f5f9; }
    .refresh:disabled { opacity: .5; cursor: default; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
    .pad { padding: 16px; margin: 20px 0; }
    .lbl { display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px; }
    .src {
      width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px;
      padding: 10px 12px; font-size: 14px; font-family: ui-monospace, Menlo, Consolas, monospace;
      resize: vertical;
    }
    .src:focus { outline: 2px solid #c7d2fe; border-color: #4f46e5; }
    .opts { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 14px; align-items: end; }
    .opt { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 600; color: #334155; }
    .opt.inline { flex-direction: row; align-items: center; gap: 7px; padding-bottom: 9px; font-weight: 500; }
    .search {
      border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; font-size: 14px;
      background: #fff; color: #0f172a; font-weight: 500;
    }
    .search:focus { outline: 2px solid #c7d2fe; border-color: #4f46e5; }
    .toolbar { display: flex; align-items: center; gap: 10px; margin: 18px 0 12px; flex-wrap: wrap; }
    .spacer { flex: 1 1 auto; }
    .act {
      border: 1px solid #cbd5e1; background: #fff; color: #0f172a; border-radius: 8px;
      padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .act:hover:not(:disabled) { background: #f1f5f9; }
    .act:disabled { opacity: .5; cursor: default; }
    .act.activate { border-color: #86efac; color: #166534; }
    .act.activate:hover:not(:disabled) { background: #f0fdf4; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
    .qr { padding: 14px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .qr img { width: 100%; height: auto; image-rendering: pixelated; }
    .qr-text {
      font-size: 12px; color: #475569; word-break: break-all; text-align: center;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .qr-acts { display: flex; gap: 6px; }
    .qr-error { text-align: center; color: #b91c1c; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
    .empty { margin-top: 20px; }
  `],
})
export class QrGeneratorComponent {
  readonly sizes = [200, 300, 400, 600, 800];

  source = '';
  size = signal(300);
  level = signal<ErrorLevel>('M');
  margin = signal(2);
  caption = signal(true);

  codes = signal<GeneratedCode[]>([]);
  busy = signal(false);
  /** Generate has run at least once — lets the empty state stay quiet on first load. */
  touched = signal(false);

  okCount = () => this.codes().filter(c => !!c.png).length;

  // Changing an option after a run re-renders what is on screen, so the controls
  // behave like knobs rather than a form you have to submit twice.
  setSize(v: string | number) { this.size.set(Number(v)); this.regenerate(); }
  setLevel(v: ErrorLevel) { this.level.set(v); this.regenerate(); }
  setMargin(v: string | number) { this.margin.set(Number(v)); this.regenerate(); }
  setCaption(v: boolean) { this.caption.set(v); }

  private regenerate() { if (this.codes().length) this.generate(); }

  /** A very long list is a paste accident more often than a real batch. */
  private readonly MAX_CODES = 200;

  async generate(): Promise<void> {
    this.touched.set(true);
    const lines = this.source
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .slice(0, this.MAX_CODES);

    if (!lines.length) {
      this.codes.set([]);
      return;
    }

    this.busy.set(true);
    try {
      const out: GeneratedCode[] = [];
      for (const text of lines) {
        try {
          out.push({ text, png: await QRCode.toDataURL(text, this.opts()), error: '' });
        } catch (e: any) {
          // One bad line (usually too much text for level H) must not lose the rest.
          out.push({ text, png: '', error: e?.message || 'Too much data for this size/level' });
        }
      }
      this.codes.set(out);
    } finally {
      this.busy.set(false);
    }
  }

  private opts() {
    return {
      width: this.size(),
      margin: this.margin(),
      errorCorrectionLevel: this.level(),
    } as const;
  }

  downloadPng(c: GeneratedCode): void {
    this.save(c.png, `${this.fileName(c.text)}.png`);
  }

  async downloadSvg(c: GeneratedCode): Promise<void> {
    const svg = await QRCode.toString(c.text, { ...this.opts(), type: 'svg' });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    this.save(url, `${this.fileName(c.text)}.svg`);
    URL.revokeObjectURL(url);
  }

  /** Browsers throttle rapid downloads, so they go out one every 150ms. */
  downloadAll(): void {
    this.codes().filter(c => c.png).forEach((c, i) => {
      setTimeout(() => this.downloadPng(c), i * 150);
    });
  }

  /**
   * Print sheet in a second window rather than a print stylesheet here: the
   * printed page then carries only the codes, with none of the admin chrome to
   * hide, and the browser's own preview handles paper size and margins.
   */
  printSheet(): void {
    const win = window.open('', '_blank');
    if (!win) return;   // popup blocked — nothing to clean up

    const cells = this.codes()
      .filter(c => c.png)
      .map(c => `<figure><img src="${c.png}" alt="">${this.caption() ? `<figcaption>${this.escape(c.text)}</figcaption>` : ''}</figure>`)
      .join('');

    win.document.write(`<!doctype html><html><head><title>QR codes</title><style>
      @page { margin: 12mm; }
      body { margin: 0; font-family: system-ui, sans-serif; }
      .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10mm; }
      figure { margin: 0; text-align: center; break-inside: avoid; }
      img { width: 100%; height: auto; image-rendering: pixelated; }
      figcaption { font-size: 9pt; color: #334155; word-break: break-all; margin-top: 2mm; }
    </style></head><body><div class="sheet">${cells}</div></body></html>`);
    win.document.close();
    // Give the images a tick to decode, or the print preview comes up blank.
    win.setTimeout(() => win.print(), 300);
  }

  private save(href: string, name: string): void {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
  }

  /** A filename from the content: readable, and safe on Windows. */
  private fileName(text: string): string {
    const cleaned = text
      .replace(/^https?:\/\//, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return cleaned || 'qr';
  }

  private escape(s: string): string {
    return s.replace(/[&<>"]/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string
    ));
  }
}
