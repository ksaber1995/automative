import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DOCUMENT } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DemoLeadService } from './demo-lead.service';
import { environment } from '../environments/environment';

type Currency = 'EGP' | 'SAR';
type Lang = 'en' | 'ar';

const LANG_STORAGE_KEY = 'netrofit.lang';

interface Benefit { icon: string; titleKey: string; textKey: string; }
interface Feature { icon: string; titleKey: string; textKey: string; }
interface Testimonial { quoteKey: string; authorKey: string; roleKey: string; }
interface Faq { qKey: string; aKey: string; }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <!-- Sticky top nav -->
    <header class="fixed top-0 inset-x-0 z-40 bg-white/80 backdrop-blur border-b border-gray-100">
      <div class="container-custom h-16 flex items-center justify-between">
        <a href="#top" class="flex items-center gap-2">
          <span class="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold">N</span>
          <span class="font-bold text-lg text-gray-900">Netrofit</span>
        </a>
        <nav class="hidden md:flex items-center gap-8 text-sm font-medium text-gray-700">
          <a href="#benefits" class="hover:text-brand-600">{{ 'NAV.BENEFITS' | translate }}</a>
          <a href="#features" class="hover:text-brand-600">{{ 'NAV.FEATURES' | translate }}</a>
          <a href="#pricing" class="hover:text-brand-600">{{ 'NAV.PRICING' | translate }}</a>
          <a href="#partners" class="hover:text-brand-600">{{ 'NAV.PARTNERS' | translate }}</a>
          <a href="#faq" class="hover:text-brand-600">{{ 'NAV.FAQ' | translate }}</a>
        </nav>
        <div class="flex items-center gap-2">
          <button
            (click)="toggleLang()"
            [attr.aria-label]="'LANG.TOGGLE' | translate"
            [title]="'LANG.TOGGLE' | translate"
            class="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:border-brand-600 hover:text-brand-600 transition-all">
            <span class="text-base">🌐</span>
            <span class="ms-1">{{ (lang() === 'en' ? 'LANG.AR' : 'LANG.EN') | translate }}</span>
          </button>
          <button (click)="openDemo('nav')" class="btn-primary py-2 px-4 text-sm">
            📅 {{ 'NAV.BOOK_DEMO' | translate }}
          </button>
        </div>
      </div>
    </header>

    <!-- HERO -->
    <section id="top" class="pt-28 pb-20 bg-gradient-to-br from-brand-50 via-white to-white relative overflow-hidden">
      <div class="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      <div class="container-custom relative">
        <div class="max-w-3xl">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold mb-6">
            <span class="w-2 h-2 rounded-full bg-brand-500 animate-pulse"></span>
            {{ 'HERO.BADGE' | translate }}
          </div>
          <h1 class="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-gray-900 leading-[1.05]">
            {{ 'HERO.HEADLINE_1' | translate }}
            <span class="line-through text-gray-400">{{ 'HERO.HEADLINE_STRIKE' | translate }}</span>.
            <span class="bg-gradient-to-r from-brand-600 to-brand-900 bg-clip-text text-transparent">{{ 'HERO.HEADLINE_2' | translate }}</span>
          </h1>
          <p class="mt-6 text-lg sm:text-xl text-gray-600 max-w-2xl">{{ 'HERO.SUBTITLE' | translate }}</p>
          <div class="mt-8 flex flex-col sm:flex-row gap-3">
            <button (click)="openDemo('hero')" class="btn-primary text-base">{{ 'HERO.CTA_PRIMARY' | translate }}</button>
            <a href="#pricing" class="btn-secondary text-base">{{ 'HERO.CTA_SECONDARY' | translate }}</a>
          </div>
          <div class="mt-8 flex flex-wrap items-center gap-6 text-sm text-gray-500">
            <div class="flex items-center gap-2"><span class="text-green-600">✓</span> {{ 'HERO.PERK_1' | translate }}</div>
            <div class="flex items-center gap-2"><span class="text-green-600">✓</span> {{ 'HERO.PERK_2' | translate }}</div>
            <div class="flex items-center gap-2"><span class="text-green-600">✓</span> {{ 'HERO.PERK_3' | translate }}</div>
          </div>
        </div>

        <!-- Stats strip -->
        <div class="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div class="text-3xl font-extrabold text-brand-600">100+</div>
            <div class="text-sm text-gray-500 mt-1">{{ 'HERO.STAT_CENTERS' | translate }}</div>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div class="text-3xl font-extrabold text-brand-600">25K+</div>
            <div class="text-sm text-gray-500 mt-1">{{ 'HERO.STAT_STUDENTS' | translate }}</div>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div class="text-3xl font-extrabold text-brand-600">30hrs</div>
            <div class="text-sm text-gray-500 mt-1">{{ 'HERO.STAT_HOURS' | translate }}</div>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div class="text-3xl font-extrabold text-brand-600">4.9/5</div>
            <div class="text-sm text-gray-500 mt-1">{{ 'HERO.STAT_RATING' | translate }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- BENEFITS -->
    <section id="benefits" class="py-20 bg-white">
      <div class="container-custom">
        <div class="text-center max-w-2xl mx-auto mb-14">
          <p class="text-sm font-semibold text-brand-600 uppercase tracking-wider">{{ 'BENEFITS.KICKER' | translate }}</p>
          <h2 class="mt-2 text-3xl sm:text-4xl font-bold text-gray-900">{{ 'BENEFITS.HEADING' | translate }}</h2>
          <p class="mt-4 text-lg text-gray-600">{{ 'BENEFITS.SUB' | translate }}</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          @for (b of benefits; track b.titleKey) {
            <div class="p-6 rounded-2xl border border-gray-100 hover:border-brand-200 hover:shadow-lg hover:-translate-y-1 transition-all">
              <div class="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center text-2xl mb-4">{{ b.icon }}</div>
              <h3 class="font-bold text-lg text-gray-900 mb-2">{{ b.titleKey | translate }}</h3>
              <p class="text-gray-600 text-sm leading-relaxed">{{ b.textKey | translate }}</p>
            </div>
          }
        </div>
      </div>
    </section>

    <!-- FEATURES -->
    <section id="features" class="py-20 bg-gray-50">
      <div class="container-custom">
        <div class="text-center max-w-2xl mx-auto mb-14">
          <p class="text-sm font-semibold text-brand-600 uppercase tracking-wider">{{ 'FEATURES.KICKER' | translate }}</p>
          <h2 class="mt-2 text-3xl sm:text-4xl font-bold text-gray-900">{{ 'FEATURES.HEADING' | translate }}</h2>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          @for (f of features; track f.titleKey) {
            <div class="flex gap-4 p-6 rounded-2xl bg-white shadow-sm border border-gray-100">
              <div class="w-12 h-12 rounded-xl bg-brand-600 text-white flex items-center justify-center text-xl flex-shrink-0">{{ f.icon }}</div>
              <div>
                <h3 class="font-bold text-gray-900 mb-1">{{ f.titleKey | translate }}</h3>
                <p class="text-gray-600 text-sm">{{ f.textKey | translate }}</p>
              </div>
            </div>
          }
        </div>
      </div>
    </section>

    <!-- PRICING -->
    <section id="pricing" class="py-20 bg-white">
      <div class="container-custom">
        <div class="text-center max-w-2xl mx-auto mb-10">
          <p class="text-sm font-semibold text-brand-600 uppercase tracking-wider">{{ 'PRICING.KICKER' | translate }}</p>
          <h2 class="mt-2 text-3xl sm:text-4xl font-bold text-gray-900">{{ 'PRICING.HEADING' | translate }}</h2>
          <p class="mt-4 text-lg text-gray-600">{{ 'PRICING.SUB' | translate }}</p>

          <div class="mt-8 inline-flex items-center gap-2 p-1 rounded-full bg-gray-100">
            <button
              (click)="billing.set('annual')"
              [class.bg-white]="billing() === 'annual'"
              [class.shadow]="billing() === 'annual'"
              [class.text-brand-700]="billing() === 'annual'"
              [class.text-gray-500]="billing() !== 'annual'"
              class="px-4 py-2 rounded-full font-medium text-sm">
              {{ 'PRICING.TOGGLE_ANNUAL' | translate }}
            </button>
            <button
              (click)="billing.set('monthly')"
              [class.bg-white]="billing() === 'monthly'"
              [class.shadow]="billing() === 'monthly'"
              [class.text-brand-700]="billing() === 'monthly'"
              [class.text-gray-500]="billing() !== 'monthly'"
              class="px-4 py-2 rounded-full font-medium text-sm">
              {{ 'PRICING.TOGGLE_MONTHLY' | translate }}
            </button>
          </div>

          <div class="mt-4 inline-flex items-center gap-2 p-1 rounded-full bg-gray-100">
            <button
              (click)="currency.set('EGP')"
              [class.bg-white]="currency() === 'EGP'"
              [class.shadow]="currency() === 'EGP'"
              class="px-4 py-2 rounded-full font-medium text-sm">
              🇪🇬 EGP
            </button>
            <button
              (click)="currency.set('SAR')"
              [class.bg-white]="currency() === 'SAR'"
              [class.shadow]="currency() === 'SAR'"
              class="px-4 py-2 rounded-full font-medium text-sm">
              🇸🇦 SAR
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          @for (p of pricing(); track p.tierKey; let i = $index) {
            <div
              class="relative p-8 rounded-2xl border-2"
              [class.border-brand-600]="i === 1"
              [class.shadow-2xl]="i === 1"
              [class.border-gray-100]="i !== 1">
              @if (i === 1) {
                <div class="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand-600 text-white text-xs font-bold">
                  {{ 'PRICING.MOST_POPULAR' | translate }}
                </div>
              }
              <h3 class="font-bold text-xl text-gray-900">{{ p.tierKey | translate }}</h3>
              <p class="text-sm text-gray-500 mt-1">{{ p.subtitleKey | translate }}</p>
              <div class="mt-6">
                <span class="text-4xl font-extrabold text-gray-900">{{ p.price | number }}</span>
                <span class="text-gray-500 ms-1">{{ currency() }}{{ 'PRICING.PER_MONTH' | translate }}</span>
              </div>
              @if (billing() === 'annual') {
                <div class="text-sm text-green-600 font-medium mt-1">{{ 'PRICING.BILLED_ANNUALLY' | translate }}</div>
              } @else {
                <div class="text-sm text-gray-400 mt-1">{{ 'PRICING.BILLED_MONTHLY' | translate }}</div>
              }
              <ul class="mt-6 space-y-3">
                @for (featKey of p.featureKeys; track featKey) {
                  <li class="flex items-start gap-2 text-sm text-gray-700">
                    <span class="text-green-600 mt-0.5">✓</span>
                    <span>{{ featKey | translate }}</span>
                  </li>
                }
              </ul>
              <button
                (click)="openDemo('pricing-' + p.sourceTag)"
                class="mt-8 w-full"
                [class.btn-primary]="i === 1"
                [class.btn-secondary]="i !== 1">
                {{ 'PRICING.CTA' | translate }}
              </button>
            </div>
          }
        </div>

        <p class="text-center mt-10 text-sm text-gray-500">
          {{ 'PRICING.CUSTOM_PREFIX' | translate }}
          <button (click)="openDemo('pricing-custom')" class="text-brand-600 font-medium hover:underline">{{ 'PRICING.CUSTOM_CTA' | translate }}</button>
        </p>
      </div>
    </section>

    <!-- PARTNERS -->
    <section id="partners" class="py-20 bg-gray-50">
      <div class="container-custom">
        <div class="text-center mb-10">
          <p class="text-sm font-semibold text-brand-600 uppercase tracking-wider">{{ 'PARTNERS.KICKER' | translate }}</p>
          <h2 class="mt-2 text-3xl font-bold text-gray-900">{{ 'PARTNERS.HEADING' | translate }}</h2>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6 items-center">
          @for (p of partners; track p) {
            <div class="h-16 rounded-lg bg-white border border-gray-100 flex items-center justify-center text-gray-400 font-semibold">{{ p }}</div>
          }
        </div>

        <div class="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          @for (t of testimonials; track t.authorKey) {
            <div class="p-6 rounded-2xl bg-white border border-gray-100">
              <div class="text-yellow-400 mb-3">★★★★★</div>
              <p class="text-gray-700 italic">"{{ t.quoteKey | translate }}"</p>
              <div class="mt-4 flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-white font-bold">
                  {{ (t.authorKey | translate)[0] }}
                </div>
                <div>
                  <div class="font-semibold text-gray-900 text-sm">{{ t.authorKey | translate }}</div>
                  <div class="text-xs text-gray-500">{{ t.roleKey | translate }}</div>
                </div>
              </div>
            </div>
          }
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section id="faq" class="py-20 bg-white">
      <div class="container-custom max-w-3xl">
        <div class="text-center mb-10">
          <p class="text-sm font-semibold text-brand-600 uppercase tracking-wider">{{ 'FAQ.KICKER' | translate }}</p>
          <h2 class="mt-2 text-3xl font-bold text-gray-900">{{ 'FAQ.HEADING' | translate }}</h2>
        </div>
        <div class="space-y-3">
          @for (q of faqs; track q.qKey) {
            <details class="group p-5 rounded-xl border border-gray-100 hover:border-brand-200 open:border-brand-300 open:bg-brand-50/30">
              <summary class="flex justify-between items-center cursor-pointer list-none">
                <span class="font-semibold text-gray-900">{{ q.qKey | translate }}</span>
                <span class="text-brand-600 text-2xl group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p class="mt-3 text-gray-600 leading-relaxed">{{ q.aKey | translate }}</p>
            </details>
          }
        </div>
      </div>
    </section>

    <!-- BIG FINAL CTA -->
    <section class="py-20 bg-gradient-to-br from-brand-600 to-brand-900 text-white">
      <div class="container-custom text-center">
        <h2 class="text-3xl sm:text-4xl font-bold">{{ 'CTA.HEADING' | translate }}</h2>
        <p class="mt-4 text-lg text-brand-100 max-w-2xl mx-auto">{{ 'CTA.SUB' | translate }}</p>
        <button (click)="openDemo('final-cta')" class="mt-8 px-8 py-4 rounded-lg bg-white text-brand-700 font-bold text-lg hover:bg-brand-50 shadow-2xl">
          {{ 'CTA.BUTTON' | translate }}
        </button>
        <p class="mt-4 text-sm text-brand-200">{{ 'CTA.FINE_PRINT' | translate }}</p>
      </div>
    </section>

    <!-- FOOTER -->
    <footer class="py-10 bg-gray-900 text-gray-400 text-sm">
      <div class="container-custom flex flex-col md:flex-row justify-between gap-6">
        <div>
          <div class="flex items-center gap-2 mb-2">
            <span class="w-7 h-7 rounded bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold">N</span>
            <span class="font-bold text-white">Netrofit</span>
          </div>
          <p>{{ 'FOOTER.COPY' | translate: { year: currentYear } }}</p>
        </div>
        <div class="flex gap-6">
          <a href="#benefits" class="hover:text-white">{{ 'NAV.BENEFITS' | translate }}</a>
          <a href="#pricing" class="hover:text-white">{{ 'NAV.PRICING' | translate }}</a>
          <a href="#faq" class="hover:text-white">{{ 'NAV.FAQ' | translate }}</a>
        </div>
      </div>
    </footer>

    <!-- Sticky WhatsApp button -->
    <a [href]="whatsappLink()" target="_blank" rel="noopener"
       class="fixed bottom-6 end-6 w-14 h-14 rounded-full bg-green-500 text-white flex items-center justify-center shadow-2xl hover:bg-green-600 hover:scale-110 transition-all z-40"
       [title]="'WHATSAPP.TITLE' | translate">
      <span class="text-2xl">💬</span>
    </a>

    <!-- Demo modal -->
    @if (showModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
           (click)="closeModal()">
        <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 sm:p-8"
             (click)="$event.stopPropagation()">
          @if (submitted()) {
            <div class="text-center py-6">
              <div class="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-4xl mx-auto mb-4">✓</div>
              <h3 class="text-2xl font-bold text-gray-900 mb-2">{{ 'MODAL.SUCCESS_TITLE' | translate }}</h3>
              <p class="text-gray-600">{{ successMessage() }}</p>
              <button (click)="closeModal()" class="btn-primary mt-6">{{ 'MODAL.CLOSE' | translate }}</button>
            </div>
          } @else {
            <div class="flex justify-between items-start mb-6">
              <div>
                <h3 class="text-2xl font-bold text-gray-900">{{ 'MODAL.TITLE' | translate }}</h3>
                <p class="text-sm text-gray-500 mt-1">{{ 'MODAL.SUB' | translate }}</p>
              </div>
              <button (click)="closeModal()" class="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            <form (ngSubmit)="submit()" #f="ngForm" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'MODAL.NAME' | translate }} *</label>
                <input type="text" name="name" [(ngModel)]="form.name" required minlength="2"
                  class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" />
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'MODAL.EMAIL' | translate }} *</label>
                  <input type="email" name="email" [(ngModel)]="form.email" required
                    class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'MODAL.PHONE' | translate }}</label>
                  <input type="tel" name="phone" [(ngModel)]="form.phone" [placeholder]="'MODAL.PHONE_PLACEHOLDER' | translate"
                    class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" />
                </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'MODAL.ACADEMY' | translate }}</label>
                  <input type="text" name="company" [(ngModel)]="form.company"
                    class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'MODAL.COUNTRY' | translate }}</label>
                  <select name="country" [(ngModel)]="form.country"
                    class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none">
                    <option value="">{{ 'MODAL.COUNTRY_PLACEHOLDER' | translate }}</option>
                    <option value="EG">{{ 'MODAL.COUNTRY_EGYPT' | translate }}</option>
                    <option value="SA">{{ 'MODAL.COUNTRY_SAUDI' | translate }}</option>
                    <option value="AE">{{ 'MODAL.COUNTRY_UAE' | translate }}</option>
                    <option value="OTHER">{{ 'MODAL.COUNTRY_OTHER' | translate }}</option>
                  </select>
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'MODAL.BRANCHES' | translate }}</label>
                <input type="number" name="branchCount" [(ngModel)]="form.branchCount" min="1"
                  class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'MODAL.MESSAGE' | translate }}</label>
                <textarea name="message" [(ngModel)]="form.message" rows="2"
                  class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"></textarea>
              </div>

              @if (error()) {
                <div class="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{{ error() }}</div>
              }

              <button type="submit" [disabled]="!f.valid || submitting()"
                class="btn-primary w-full text-base disabled:opacity-50 disabled:cursor-not-allowed">
                @if (submitting()) {
                  <span>{{ 'MODAL.SUBMITTING' | translate }}</span>
                } @else {
                  <span>{{ 'MODAL.SUBMIT' | translate }}</span>
                }
              </button>
              <p class="text-xs text-gray-500 text-center">{{ 'MODAL.FINE_PRINT' | translate }}</p>
            </form>
          }
        </div>
      </div>
    }
  `,
})
export class LandingComponent {
  private demoLeadService = inject(DemoLeadService);
  private translate = inject(TranslateService);
  private doc = inject(DOCUMENT);

  currentYear = new Date().getFullYear();
  billing = signal<'annual' | 'monthly'>('annual');
  currency = signal<Currency>('EGP');
  lang = signal<Lang>('en');

  showModal = signal(false);
  submitting = signal(false);
  submitted = signal(false);
  error = signal<string | null>(null);
  successMessage = signal('');

  form: {
    name: string;
    email: string;
    phone: string;
    company: string;
    country: string;
    branchCount: number | null;
    message: string;
  } = {
    name: '',
    email: '',
    phone: '',
    company: '',
    country: '',
    branchCount: null,
    message: '',
  };

  private source = 'landing';

  benefits: Benefit[] = [
    { icon: '📊', titleKey: 'BENEFITS.ITEMS.REALTIME_TITLE', textKey: 'BENEFITS.ITEMS.REALTIME_TEXT' },
    { icon: '🏢', titleKey: 'BENEFITS.ITEMS.MULTIBRANCH_TITLE', textKey: 'BENEFITS.ITEMS.MULTIBRANCH_TEXT' },
    { icon: '💰', titleKey: 'BENEFITS.ITEMS.INSTALLMENTS_TITLE', textKey: 'BENEFITS.ITEMS.INSTALLMENTS_TEXT' },
    { icon: '🇦🇪', titleKey: 'BENEFITS.ITEMS.ARABIC_TITLE', textKey: 'BENEFITS.ITEMS.ARABIC_TEXT' },
    { icon: '👨‍🏫', titleKey: 'BENEFITS.ITEMS.PAYROLL_TITLE', textKey: 'BENEFITS.ITEMS.PAYROLL_TEXT' },
    { icon: '📱', titleKey: 'BENEFITS.ITEMS.MOBILE_TITLE', textKey: 'BENEFITS.ITEMS.MOBILE_TEXT' },
  ];

  features: Feature[] = [
    { icon: '🎓', titleKey: 'FEATURES.ITEMS.STUDENTS_TITLE', textKey: 'FEATURES.ITEMS.STUDENTS_TEXT' },
    { icon: '📚', titleKey: 'FEATURES.ITEMS.COURSES_TITLE', textKey: 'FEATURES.ITEMS.COURSES_TEXT' },
    { icon: '📦', titleKey: 'FEATURES.ITEMS.INVENTORY_TITLE', textKey: 'FEATURES.ITEMS.INVENTORY_TEXT' },
    { icon: '🧾', titleKey: 'FEATURES.ITEMS.EXPENSES_TITLE', textKey: 'FEATURES.ITEMS.EXPENSES_TEXT' },
    { icon: '📈', titleKey: 'FEATURES.ITEMS.ANALYTICS_TITLE', textKey: 'FEATURES.ITEMS.ANALYTICS_TEXT' },
    { icon: '🎁', titleKey: 'FEATURES.ITEMS.BUNDLES_TITLE', textKey: 'FEATURES.ITEMS.BUNDLES_TEXT' },
  ];

  partners = ['Vodafone Cash', 'Fawry', 'InstaPay', 'Mada', 'STC Pay', 'WhatsApp'];

  testimonials: Testimonial[] = [
    { quoteKey: 'TESTIMONIALS.T1_QUOTE', authorKey: 'TESTIMONIALS.T1_AUTHOR', roleKey: 'TESTIMONIALS.T1_ROLE' },
    { quoteKey: 'TESTIMONIALS.T2_QUOTE', authorKey: 'TESTIMONIALS.T2_AUTHOR', roleKey: 'TESTIMONIALS.T2_ROLE' },
    { quoteKey: 'TESTIMONIALS.T3_QUOTE', authorKey: 'TESTIMONIALS.T3_AUTHOR', roleKey: 'TESTIMONIALS.T3_ROLE' },
  ];

  faqs: Faq[] = [
    { qKey: 'FAQ.Q1', aKey: 'FAQ.A1' },
    { qKey: 'FAQ.Q2', aKey: 'FAQ.A2' },
    { qKey: 'FAQ.Q3', aKey: 'FAQ.A3' },
    { qKey: 'FAQ.Q4', aKey: 'FAQ.A4' },
    { qKey: 'FAQ.Q5', aKey: 'FAQ.A5' },
    { qKey: 'FAQ.Q6', aKey: 'FAQ.A6' },
  ];

  whatsappLink = computed(() => {
    const phone = environment.whatsappPhone.replace(/\D/g, '');
    const text = encodeURIComponent(this.translate.instant('WHATSAPP.MESSAGE'));
    return `https://wa.me/${phone}?text=${text}`;
  });

  pricing = computed(() => {
    const isAnnual = this.billing() === 'annual';
    const cur = this.currency();

    const egp = {
      starter: { monthly: 1922, annual: 1538 },
      growth: { monthly: 3838, annual: 3070 },
      pro: { monthly: 6398, annual: 5118 },
    };
    const sar = {
      starter: { monthly: 538, annual: 430 },
      growth: { monthly: 1078, annual: 862 },
      pro: { monthly: 1798, annual: 1438 },
    };
    const p = cur === 'EGP' ? egp : sar;
    const key: 'monthly' | 'annual' = isAnnual ? 'annual' : 'monthly';

    return [
      {
        tierKey: 'PRICING.PLANS.STARTER_TIER',
        subtitleKey: 'PRICING.PLANS.STARTER_SUB',
        sourceTag: 'starter',
        price: p.starter[key],
        featureKeys: [
          'PRICING.PLANS.STARTER_FEAT_1',
          'PRICING.PLANS.STARTER_FEAT_2',
          'PRICING.PLANS.STARTER_FEAT_3',
          'PRICING.PLANS.STARTER_FEAT_4',
          'PRICING.PLANS.STARTER_FEAT_5',
        ],
      },
      {
        tierKey: 'PRICING.PLANS.GROWTH_TIER',
        subtitleKey: 'PRICING.PLANS.GROWTH_SUB',
        sourceTag: 'growth',
        price: p.growth[key],
        featureKeys: [
          'PRICING.PLANS.GROWTH_FEAT_1',
          'PRICING.PLANS.GROWTH_FEAT_2',
          'PRICING.PLANS.GROWTH_FEAT_3',
          'PRICING.PLANS.GROWTH_FEAT_4',
          'PRICING.PLANS.GROWTH_FEAT_5',
        ],
      },
      {
        tierKey: 'PRICING.PLANS.PRO_TIER',
        subtitleKey: 'PRICING.PLANS.PRO_SUB',
        sourceTag: 'pro',
        price: p.pro[key],
        featureKeys: [
          'PRICING.PLANS.PRO_FEAT_1',
          'PRICING.PLANS.PRO_FEAT_2',
          'PRICING.PLANS.PRO_FEAT_3',
          'PRICING.PLANS.PRO_FEAT_4',
          'PRICING.PLANS.PRO_FEAT_5',
        ],
      },
    ];
  });

  constructor() {
    // Load saved language preference or fall back to browser, then English.
    const saved = this.readSavedLang();
    const initial: Lang =
      saved ??
      ((this.translate.getBrowserLang() || '').startsWith('ar') ? 'ar' : 'en');

    this.translate.addLangs(['en', 'ar']);
    this.translate.setDefaultLang('en');
    this.translate.use(initial);
    this.lang.set(initial);
    this.applyDir(initial);

    // Keep <html> in sync with language on every change.
    effect(() => {
      const current = this.lang();
      this.applyDir(current);
      this.translate.use(current);
      this.writeSavedLang(current);
    });
  }

  toggleLang() {
    this.lang.set(this.lang() === 'en' ? 'ar' : 'en');
  }

  private applyDir(l: Lang) {
    const html = this.doc.documentElement;
    html.lang = l;
    html.dir = l === 'ar' ? 'rtl' : 'ltr';
  }

  private readSavedLang(): Lang | null {
    try {
      const v = localStorage.getItem(LANG_STORAGE_KEY);
      return v === 'ar' || v === 'en' ? v : null;
    } catch { return null; }
  }

  private writeSavedLang(l: Lang) {
    try { localStorage.setItem(LANG_STORAGE_KEY, l); } catch { /* ignore */ }
  }

  openDemo(source: string) {
    this.source = source;
    this.showModal.set(true);
    this.submitted.set(false);
    this.error.set(null);
  }

  closeModal() {
    this.showModal.set(false);
    if (this.submitted()) {
      this.form = { name: '', email: '', phone: '', company: '', country: '', branchCount: null, message: '' };
      this.submitted.set(false);
    }
  }

  submit() {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);

    this.demoLeadService
      .submit({
        name: this.form.name.trim(),
        email: this.form.email.trim(),
        phone: this.form.phone.trim() || undefined,
        company: this.form.company.trim() || undefined,
        country: this.form.country || undefined,
        branchCount: this.form.branchCount ?? undefined,
        message: this.form.message.trim() || undefined,
        source: this.source,
      })
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.submitted.set(true);
          this.successMessage.set(res.message || '');
        },
        error: (err) => {
          this.submitting.set(false);
          const fallback = this.translate.instant('MODAL.GENERIC_ERROR');
          this.error.set(err?.error?.message || fallback);
        },
      });
  }
}
