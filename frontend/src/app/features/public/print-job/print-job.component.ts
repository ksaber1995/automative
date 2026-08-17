import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { environment } from '../../../../environments/environment';
import { canExportCustom, loadCardImages, renderAgnosticCardPng } from '../../students/card-render.util';
// The types are not re-exported by card-render.util, so they come from where
// they are declared rather than widening that module's surface for one page.
import type { AgnosticCardData, AgnosticTemplate } from '../../students/card-agnostic.util';
import type { CardImages } from '../../students/student-card.util';

interface PrintJob {
  academyName: string;
  address: string | null;
  contactPhone: string | null;
  note: string | null;
  expiresAt: string | null;
  cardDesign: any | null;
  cards: { token: string; serial: number }[];
}

/**
 * The page the print shop opens.
 *
 * Deliberately outside the app shell and behind no login: the printer is not a
 * user of this system and never will be. The link in their inbox is the whole
 * credential, and this page shows them exactly three things — what to print,
 * where to send it, and who to call.
 *
 * Cards are rendered here in the browser, with the academy's own artwork, using
 * the same renderer the tenant's own QR-cards page uses. Nothing about a student
 * appears on them: a card in a box belongs to nobody yet.
 */
@Component({
  selector: 'app-print-job',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <div class="wrap">
      @if (loading()) {
        <p class="state">{{ 'PRINT_JOB.LOADING' | translate }}</p>
      } @else if (error()) {
        <div class="card">
          <h1>{{ 'PRINT_JOB.UNAVAILABLE_TITLE' | translate }}</h1>
          <p class="muted">{{ 'PRINT_JOB.UNAVAILABLE_BODY' | translate }}</p>
        </div>
      } @else if (job(); as j) {
        <div class="card">
          <div class="eyebrow">{{ 'PRINT_JOB.EYEBROW' | translate }}</div>
          <h1>{{ j.academyName }}</h1>
          @if (j.note) { <p class="note">{{ j.note }}</p> }

          <div class="grid">
            <div class="stat">
              <span class="l">{{ 'PRINT_JOB.CARDS' | translate }}</span>
              <span class="v">{{ j.cards.length }}</span>
            </div>
            @if (range(); as r) {
              <div class="stat">
                <span class="l">{{ 'PRINT_JOB.NUMBERS' | translate }}</span>
                <!-- Always LTR: a serial range reads left-to-right even on an
                     RTL page, or "0500 – 0599" comes out backwards. -->
                <span class="v mono" dir="ltr">{{ r }}</span>
              </div>
            }
          </div>

          <!-- The reason this page exists. -->
          <section class="ship">
            <h2>{{ 'PRINT_JOB.SHIP_TO' | translate }}</h2>
            @if (j.address) {
              <p class="address">{{ j.address }}</p>
            } @else {
              <p class="warn">{{ 'PRINT_JOB.NO_ADDRESS' | translate }}</p>
            }
            @if (j.contactPhone) {
              <p class="muted">
                {{ 'PRINT_JOB.CONTACT' | translate }}:
                <a [href]="'tel:' + j.contactPhone" dir="ltr">{{ j.contactPhone }}</a>
              </p>
            }
          </section>

          @if (exporting()) {
            <p class="state">{{ 'PRINT_JOB.PREPARING' | translate: { done: done(), total: total() } }}</p>
          } @else {
            <button class="download" [disabled]="!j.cards.length" (click)="download()">
              {{ 'PRINT_JOB.DOWNLOAD' | translate: { count: j.cards.length } }}
            </button>
          }

          @if (failed(); as f) { <p class="warn">{{ f | translate }}</p> }

          @if (j.expiresAt) {
            <p class="foot">
              {{ 'PRINT_JOB.EXPIRES' | translate: { date: (j.expiresAt | date: 'mediumDate') } }}
            </p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; background: #f1f5f9; min-height: 100vh; }
    .wrap { max-width: 560px; margin: 0 auto; padding: 32px 16px 64px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; }
    .card { background: #fff; border-radius: 14px; padding: 26px 24px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #64748b; }
    h1 { font-size: 22px; margin: 4px 0 0; }
    .note { color: #475569; margin: 8px 0 0; }
    .grid { display: flex; gap: 28px; margin: 20px 0 4px; }
    .stat .l { display: block; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
    .stat .v { display: block; font-size: 24px; font-weight: 700; }
    .mono { font-family: ui-monospace, monospace; font-size: 18px !important; }
    .ship { margin-top: 22px; border-top: 1px solid #e2e8f0; padding-top: 18px; }
    .ship h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; margin: 0 0 8px; }
    .address { font-size: 17px; line-height: 1.5; white-space: pre-wrap; margin: 0; font-weight: 600; }
    .muted { color: #64748b; font-size: 14px; }
    .warn { color: #b45309; background: #fffbeb; border: 1px solid #fde68a; padding: 10px 12px; border-radius: 8px; font-size: 14px; }
    .download {
      width: 100%; margin-top: 22px; border: 0; background: #4f46e5; color: #fff;
      border-radius: 10px; padding: 14px; font-size: 15px; font-weight: 700; cursor: pointer;
    }
    .download:hover:not(:disabled) { background: #4338ca; }
    .download:disabled { opacity: .5; cursor: default; }
    .state { text-align: center; color: #64748b; padding: 16px 0; }
    .foot { margin: 16px 0 0; font-size: 12px; color: #94a3b8; text-align: center; }
  `],
})
export class PrintJobComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private translate = inject(TranslateService);

  protected job = signal<PrintJob | null>(null);
  protected loading = signal(true);
  protected error = signal(false);
  protected exporting = signal(false);
  protected failed = signal<string | null>(null);
  protected done = signal(0);
  protected total = signal(0);

  private token = '';

  ngOnInit(): void {
    // Arabic, always. The audience is an Egyptian print shop, never a signed-in
    // user with a stored preference.
    //
    // translate.use, NOT languageService.setLanguage: the latter writes to
    // localStorage, so opening a print link in your own browser would flip the
    // whole app to Arabic afterwards. This is scoped to the page and forgotten.
    this.translate.use('ar');
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.http.get<PrintJob>(`${environment.apiUrl}/public/print-jobs/${this.token}`).subscribe({
      next: (j) => { this.job.set(j); this.loading.set(false); },
      // One message for expired, revoked and never-existed: the server does not
      // distinguish them either.
      error: () => { this.error.set(true); this.loading.set(false); },
    });
  }

  /** "0500 – 0599", so the printer can check the box against the paperwork. */
  protected range(): string | null {
    const cards = this.job()?.cards ?? [];
    if (!cards.length) return null;
    const label = (s: number) => (s >= 900000 ? `0${s - 900000}` : s > 100000 ? `A${s - 100000}` : String(s));
    const first = label(cards[0].serial);
    const last = label(cards[cards.length - 1].serial);
    return first === last ? first : `${first} – ${last}`;
  }

  protected async download(): Promise<void> {
    const j = this.job();
    if (!j || !j.cards.length || this.exporting()) return;

    this.failed.set(null);
    this.exporting.set(true);
    this.done.set(0);
    this.total.set(j.cards.length);

    try {
      const design = j.cardDesign ?? null;
      const template = design?.agnosticTemplate as AgnosticTemplate | undefined;

      // Refuse rather than ship a thousand blank faces. The tenant's own artwork
      // is only usable if both sides are actually present; the same guard the
      // in-app export uses, and for the same reason — this batch gets printed.
      if (template === 'custom' && !canExportCustom(design)) {
        this.failed.set('PRINT_JOB.CUSTOM_ART_MISSING');
        return;
      }

      const images: CardImages = await loadCardImages(design);
      const canvas = document.createElement('canvas');
      await document.fonts.ready;   // Arabic must shape before rasterising

      const zip = new JSZip();
      const label = (s: number) => (s >= 900000 ? `0${s - 900000}` : s > 100000 ? `A${s - 100000}` : String(s));
      let n = 0;
      for (const card of j.cards) {
        const data: AgnosticCardData = {
          companyName: j.academyName,
          code: label(card.serial),
          qrUrl: `${window.location.origin}/p/s/${card.token}`,
        };
        zip.file(`${label(card.serial)}.png`, await renderAgnosticCardPng(data, canvas, template, images, design), { base64: true });
        this.done.set(++n);
        // Yield so the counter repaints rather than freezing the tab.
        if (n % 5 === 0) await new Promise((r) => setTimeout(r));
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, `${j.academyName.replace(/[^\w؀-ۿ-]+/g, '_')}-cards.zip`);

      // Tell the office it was collected. Best effort — the printer already has
      // the file, so a failure here must not look like a failed download.
      this.http.post(`${environment.apiUrl}/public/print-jobs/${this.token}/downloaded`, {}).subscribe({
        next: () => {}, error: () => {},
      });
    } catch {
      this.failed.set('PRINT_JOB.DOWNLOAD_FAILED');
    } finally {
      this.exporting.set(false);
    }
  }
}
