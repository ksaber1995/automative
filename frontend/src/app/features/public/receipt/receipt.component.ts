import { Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import QRCode from 'qrcode';
import { ApiService } from '../../../core/services/api.service';
import { LanguageService } from '../../../core/services/language.service';

export interface PaymentReceipt {
  id: string;
  receiptNumber: number;
  publicToken: string;
  sourceType: string;
  sourceId: string | null;
  studentName: string | null;
  studentPhone: string | null;
  parentPhone: string | null;
  studentCode: number | null;
  courseName: string | null;
  className: string | null;
  branchName: string | null;
  companyName: string | null;
  recordedBy: string | null;
  amount: number;
  totalDue: number | null;
  paidToDate: number | null;
  remaining: number | null;
  isFullPayment: boolean;
  periodLabel: string | null;
  paymentDate: string;
  notes: string | null;
  voidedAt: string | null;
  createdAt: string;
}

/**
 * A printed payment receipt — and the page its own QR points at.
 *
 * ONE component does both jobs on purpose. The slip is printed from this page,
 * and the QR printed on it encodes this same URL, so whoever scans it later sees
 * exactly what was handed over. Two components would drift apart, and the paper
 * would then disagree with the screen.
 *
 * Public and unauthenticated, mounted outside the layout/authGuard (like the
 * student QR profile): a parent scanning a slip has no login. The opaque token
 * is the only credential.
 *
 * Laid out for a 58mm thermal roll (~48mm printable) and printed through the
 * browser's own dialog, so it works with whatever printer the machine has
 * installed rather than being tied to one vendor's driver.
 */
@Component({
  selector: 'app-receipt',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './receipt.component.html',
  styleUrls: ['./receipt.component.scss'],
})
export class ReceiptComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  languageService = inject(LanguageService);

  loading = signal(true);
  error = signal(false);
  receipt = signal<PaymentReceipt | null>(null);
  qrDataUrl = signal<string>('');
  downloading = signal(false);

  @ViewChild('slipEl') slipEl?: ElementRef<HTMLElement>;

  /** Set by ?print=1 — the app opens it this way straight after taking money. */
  autoPrint = false;

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token') || '';
    this.autoPrint = this.route.snapshot.queryParamMap.get('print') === '1';
    if (!token) { this.loading.set(false); this.error.set(true); return; }

    this.api.get<PaymentReceipt>(`public/receipts/${token}`).subscribe({
      next: async (r) => {
        this.receipt.set(r);
        this.loading.set(false);
        await this.buildQr(token);
        // Give the QR image a paint before the print dialog freezes the page,
        // or the slip prints with an empty square where the code should be.
        if (this.autoPrint) setTimeout(() => window.print(), 350);
      },
      error: () => { this.loading.set(false); this.error.set(true); },
    });
  }

  private async buildQr(token: string) {
    try {
      const url = `${window.location.origin}/r/${token}`;
      // Printed at 24mm on a 58mm roll, so keep the module count low: a low
      // error-correction level means fewer, fatter modules, which is what
      // survives a thermal head. margin 1 keeps the quiet zone legal.
      this.qrDataUrl.set(await QRCode.toDataURL(url, {
        width: 420, margin: 1, errorCorrectionLevel: 'L',
      }));
    } catch {
      // A receipt without its QR is still a valid receipt — print it anyway.
      this.qrDataUrl.set('');
    }
  }

  print() { window.print(); }

  /**
   * The digital copy: the rendered slip captured to a one-page PDF sized like
   * the paper one. Rasterised rather than drawn with jsPDF's text API because
   * the browser already shapes Arabic correctly and jsPDF alone does not.
   */
  async download() {
    const slip = this.slipEl?.nativeElement;
    const r = this.receipt();
    if (!slip || !r || this.downloading()) return;
    this.downloading.set(true);
    try {
      // Loaded on demand, same as the student exports — most visits only print.
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      // The slip is only ~48mm wide; scale 4 keeps its small text crisp.
      const canvas = await html2canvas(slip, { scale: 4, backgroundColor: '#ffffff', logging: false });
      const wMm = 58; // the thermal roll width the slip is designed for
      const hMm = (canvas.height / canvas.width) * wMm;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [wMm, hMm] });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, wMm, hMm);
      pdf.save(`receipt-${r.receiptNumber}.pdf`);
    } finally {
      this.downloading.set(false);
    }
  }

  /** What this money was for, in words. */
  kindLabel(): string {
    const r = this.receipt();
    if (!r) return '';
    const key = `RECEIPT.KIND.${r.sourceType}`;
    const t = this.translate.instant(key);
    return t === key ? r.sourceType : t;
  }

  formatDate(value: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(this.languageService.currentLang() === 'ar' ? 'ar-EG' : 'en-GB',
      { year: 'numeric', month: 'short', day: 'numeric' });
  }

  money(v: number | null): string {
    if (v === null || v === undefined) return '';
    return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
