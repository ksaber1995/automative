import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DOCUMENT } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DemoLeadService } from './demo-lead.service';
import { RecaptchaService } from './recaptcha.service';
import { environment } from '../environments/environment';

type Currency = 'EGP' | 'SAR';
type Lang = 'en' | 'ar';

const LANG_STORAGE_KEY = 'netrofit.lang';

interface Benefit { icon: string; titleKey: string; textKey: string; }
type FeatureCategory = 'operations' | 'academics' | 'finance' | 'commerce' | 'insights';
interface Feature { icon: string; titleKey: string; textKey: string; category: FeatureCategory; }
interface FeatureCategoryMeta { id: FeatureCategory | 'all'; labelKey: string; icon: string; }
interface Faq { qKey: string; aKey: string; }
interface RoadmapPhase {
  phase: string;
  icon: string;
  dateKey: string;
  titleKey: string;
  subKey: string;
  status: 'done' | 'active' | 'upcoming';
  featureKeys: string[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <!-- Sticky top nav -->
    <header class="fixed top-0 inset-x-0 z-40 bg-white/80 backdrop-blur border-b border-gray-100">
      <div class="container-custom h-16 flex items-center justify-between">
        <a href="#top" class="flex items-center">
          <img src="logo-white.png" alt="Netrofit" style="height:60px"  />
        </a>
        <nav class="hidden md:flex items-center gap-8 text-sm font-medium text-gray-700">
          <a href="#benefits" class="hover:text-brand-600">{{ 'NAV.BENEFITS' | translate }}</a>
          <a href="#features" class="hover:text-brand-600">{{ 'NAV.FEATURES' | translate }}</a>
          <a href="#pricing" class="hover:text-brand-600">{{ 'NAV.PRICING' | translate }}</a>
          <a href="#roadmap" class="hover:text-brand-600">{{ 'NAV.ROADMAP' | translate }}</a>
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
        <div class="max-w-4xl">
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

        <!-- Value-prop strip -->
        <div class="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div class="text-3xl">🏢</div>
            <div class="text-sm font-semibold text-gray-900 mt-2">{{ 'HERO.VP_MULTIBRANCH_TITLE' | translate }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ 'HERO.VP_MULTIBRANCH_TEXT' | translate }}</div>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div class="text-3xl">💰</div>
            <div class="text-sm font-semibold text-gray-900 mt-2">{{ 'HERO.VP_FINANCE_TITLE' | translate }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ 'HERO.VP_FINANCE_TEXT' | translate }}</div>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div class="text-3xl">🌐</div>
            <div class="text-sm font-semibold text-gray-900 mt-2">{{ 'HERO.VP_BILINGUAL_TITLE' | translate }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ 'HERO.VP_BILINGUAL_TEXT' | translate }}</div>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div class="text-3xl">🔒</div>
            <div class="text-sm font-semibold text-gray-900 mt-2">{{ 'HERO.VP_RBAC_TITLE' | translate }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ 'HERO.VP_RBAC_TEXT' | translate }}</div>
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
    <section id="features" class="py-20 bg-gradient-to-b from-gray-50 via-white to-gray-50 relative overflow-hidden">
      <div class="pointer-events-none absolute -top-32 -end-32 w-96 h-96 rounded-full bg-brand-200/30 blur-3xl animate-pulse"></div>
      <div class="pointer-events-none absolute -bottom-32 -start-32 w-96 h-96 rounded-full bg-brand-100/40 blur-3xl animate-pulse" style="animation-delay:1.5s"></div>

      <div class="container-custom relative">
        <div class="text-center max-w-2xl mx-auto mb-10">
          <p class="text-sm font-semibold text-brand-600 uppercase tracking-wider">{{ 'FEATURES.KICKER' | translate }}</p>
          <h2 class="mt-2 text-3xl sm:text-4xl font-bold text-gray-900">{{ 'FEATURES.HEADING' | translate }}</h2>
          <p class="mt-3 text-gray-500 text-sm">{{ 'FEATURES.MATCH_COUNT' | translate:{ count: visibleFeatures().length, total: features.length } }}</p>
        </div>

        <!-- Category pills -->
        <div class="flex flex-wrap justify-center gap-2 mb-6">
          @for (c of featureCategories; track c.id) {
            <button
              type="button"
              (click)="activeFeatureCategory.set(c.id)"
              class="group/pill px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 inline-flex items-center gap-1.5"
              [class]="activeFeatureCategory() === c.id
                ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/30 scale-105'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-brand-400 hover:text-brand-600 hover:-translate-y-0.5'">
              <span>{{ c.icon }}</span>
              <span>{{ c.labelKey | translate }}</span>
              <span class="text-xs px-1.5 py-0.5 rounded-full"
                [class]="activeFeatureCategory() === c.id ? 'bg-white/20' : 'bg-gray-100 group-hover/pill:bg-brand-50'">
                {{ featureCountFor(c.id) }}
              </span>
            </button>
          }
        </div>

        <!-- Search -->
        <div class="max-w-md mx-auto mb-10">
          <div class="relative">
            <span class="absolute inset-y-0 start-4 flex items-center text-gray-400 pointer-events-none">🔍</span>
            <input
              type="text"
              [ngModel]="featureSearch()"
              (ngModelChange)="featureSearch.set($event)"
              [placeholder]="'FEATURES.SEARCH_PLACEHOLDER' | translate"
              class="w-full ps-11 pe-10 py-3 rounded-full border border-gray-200 bg-white/90 backdrop-blur shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-all" />
            @if (featureSearch()) {
              <button
                type="button"
                (click)="featureSearch.set('')"
                [attr.aria-label]="'FEATURES.CLEAR_SEARCH' | translate"
                class="absolute inset-y-0 end-3 flex items-center text-gray-400 hover:text-brand-600 transition-colors">
                ✕
              </button>
            }
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          @for (f of visibleFeatures(); track f.titleKey) {
            <div class="group relative p-6 rounded-2xl bg-white border border-gray-100 hover:border-brand-300 shadow-sm hover:shadow-xl hover:shadow-brand-600/10 hover:-translate-y-1 transition-all duration-300 overflow-hidden">
              <div class="absolute inset-0 bg-gradient-to-br from-brand-50/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <div class="absolute -top-10 -end-10 w-24 h-24 rounded-full bg-brand-100/50 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div class="relative flex gap-4">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center text-xl flex-shrink-0 shadow-md group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">{{ f.icon }}</div>
                <div class="min-w-0">
                  <h3 class="font-bold text-gray-900 mb-1 group-hover:text-brand-700 transition-colors">{{ f.titleKey | translate }}</h3>
                  <p class="text-gray-600 text-sm leading-relaxed">{{ f.textKey | translate }}</p>
                </div>
              </div>
            </div>
          } @empty {
            <div class="col-span-full text-center py-16">
              <div class="text-5xl mb-3">🔎</div>
              <p class="text-gray-500 mb-4">{{ 'FEATURES.EMPTY' | translate }}</p>
              <button
                type="button"
                (click)="resetFeatureFilters()"
                class="text-sm font-medium text-brand-600 hover:text-brand-700 underline">
                {{ 'FEATURES.RESET' | translate }}
              </button>
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

          <div class="mt-8 inline-flex items-stretch gap-1 p-1.5 rounded-full bg-gray-100 shadow-inner">
            <button
              (click)="billing.set('annual')"
              [class.bg-white]="billing() === 'annual'"
              [class.shadow-md]="billing() === 'annual'"
              [class.text-brand-700]="billing() === 'annual'"
              [class.ring-2]="billing() === 'annual'"
              [class.ring-brand-500]="billing() === 'annual'"
              [class.text-gray-500]="billing() !== 'annual'"
              class="relative px-5 py-2.5 rounded-full font-semibold text-sm flex items-center gap-2 transition-all">
              <span>{{ 'PRICING.TOGGLE_ANNUAL' | translate }}</span>
              <span class="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-extrabold tracking-wide">
                {{ 'PRICING.SAVE_BADGE' | translate }}
              </span>
            </button>
            <button
              (click)="billing.set('monthly')"
              [class.bg-white]="billing() === 'monthly'"
              [class.shadow-md]="billing() === 'monthly'"
              [class.text-brand-700]="billing() === 'monthly'"
              [class.text-gray-500]="billing() !== 'monthly'"
              class="px-5 py-2.5 rounded-full font-semibold text-sm transition-all">
              {{ 'PRICING.TOGGLE_MONTHLY' | translate }}
            </button>
          </div>

          @if (billing() === 'monthly') {
            <div class="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 inline-flex items-center gap-2 px-3 py-1.5 rounded-full">
              <span>💡</span>
              <span>{{ 'PRICING.SWITCH_HINT' | translate }}</span>
            </div>
          }

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

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          @for (p of pricing(); track p.tierKey; let i = $index) {
            <div
              class="relative p-8 rounded-2xl border-2 transition-all"
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

              @if (p.isCustom) {
                <div class="mt-6 flex items-baseline gap-2">
                  <span class="text-4xl font-extrabold text-gray-900">{{ 'PRICING.CUSTOM_LABEL' | translate }}</span>
                </div>
                <div class="mt-1 text-xs text-gray-500">{{ 'PRICING.CUSTOM_BILLING' | translate }}</div>
                <div class="mt-3 p-3 rounded-xl bg-indigo-50 border border-indigo-200">
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-indigo-700 text-base">📞</span>
                    <span class="text-indigo-900 font-semibold">
                      {{ p.hintKey | translate }}
                    </span>
                  </div>
                </div>
              } @else if (billing() === 'annual') {
                <div class="mt-6 flex items-baseline gap-2 flex-wrap">
                  <span class="text-lg font-medium text-gray-400 line-through">{{ p.monthlyPrice | number }}</span>
                  <span class="text-4xl font-extrabold text-gray-900">{{ p.price | number }}</span>
                  <span class="text-gray-500">{{ currency() }}{{ 'PRICING.PER_MONTH' | translate }}</span>
                </div>
                <div class="mt-1 text-xs text-gray-500">{{ 'PRICING.BILLED_ANNUALLY' | translate }}</div>
                <div class="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-emerald-700 text-base">💰</span>
                    <span class="text-emerald-900 font-semibold">
                      {{ 'PRICING.SAVE_PER_MONTH' | translate: { amount: p.monthlySavings | number, currency: currency() } }}
                    </span>
                  </div>
                </div>
              } @else {
                <div class="mt-6 flex items-baseline gap-2">
                  <span class="text-4xl font-extrabold text-gray-900">{{ p.price | number }}</span>
                  <span class="text-gray-500">{{ currency() }}{{ 'PRICING.PER_MONTH' | translate }}</span>
                </div>
                <div class="mt-1 text-xs text-gray-500">{{ 'PRICING.BILLED_MONTHLY' | translate }}</div>
                <button (click)="billing.set('annual')"
                  class="mt-3 w-full p-3 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors text-left">
                  <div class="flex items-center gap-2 text-sm">
                    <span class="text-amber-700 text-base">↩</span>
                    <span class="text-amber-900 font-semibold">
                      {{ 'PRICING.SWITCH_TO_ANNUAL_MONTHLY' | translate: { amount: p.monthlySavings | number, currency: currency() } }}
                    </span>
                  </div>
                </button>
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
                [class.btn-primary]="i === 1 || p.isCustom"
                [class.btn-secondary]="i !== 1 && !p.isCustom">
                {{ p.ctaKey | translate }}
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

    <!-- ROADMAP -->
    <section id="roadmap" class="py-24 bg-gray-950 text-white relative overflow-hidden">
      <div class="absolute top-0 start-1/4 w-96 h-96 bg-brand-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div class="absolute bottom-0 end-1/4 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div class="container-custom relative">
        <div class="text-center max-w-2xl mx-auto mb-16">
          <p class="text-sm font-semibold text-brand-400 uppercase tracking-widest mb-3">{{ 'ROADMAP.KICKER' | translate }}</p>
          <h2 class="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-tight">{{ 'ROADMAP.HEADING' | translate }}</h2>
          <p class="mt-4 text-lg text-gray-400">{{ 'ROADMAP.SUB' | translate }}</p>
        </div>

        <div class="relative max-w-4xl mx-auto">
          <div class="absolute start-[27px] top-8 bottom-8 w-0.5 bg-gradient-to-b from-brand-500 via-brand-700 to-gray-700 opacity-60"></div>

          <div class="space-y-6">
            @for (phase of roadmapPhases; track phase.phase) {
              <div class="relative ps-[4.5rem]">

                <div class="absolute start-[18px] top-7">
                  @if (phase.status === 'active') {
                    <div class="relative w-5 h-5">
                      <div class="absolute inset-0 rounded-full bg-brand-500 animate-ping opacity-50"></div>
                      <div class="relative w-5 h-5 rounded-full bg-brand-500 border-2 border-brand-300 flex items-center justify-center">
                        <span class="w-2 h-2 rounded-full bg-white block"></span>
                      </div>
                    </div>
                  }
                  @if (phase.status === 'done') {
                    <div class="w-5 h-5 rounded-full bg-emerald-500 border-2 border-emerald-300 flex items-center justify-center">
                      <span class="text-white text-[10px] font-black leading-none">✓</span>
                    </div>
                  }
                  @if (phase.status === 'upcoming') {
                    <div class="w-5 h-5 rounded-full bg-gray-700 border-2 border-gray-600 flex items-center justify-center">
                      <span class="w-2 h-2 rounded-full bg-gray-500 block"></span>
                    </div>
                  }
                </div>

                <div class="rounded-2xl border p-6 transition-all duration-200"
                     [ngClass]="{
                       'border-emerald-800 bg-emerald-950/25': phase.status === 'done',
                       'border-brand-500 bg-brand-950/30 shadow-xl': phase.status === 'active',
                       'border-gray-700 bg-gray-800/20 opacity-50': phase.status === 'upcoming'
                     }">

                  <div class="flex items-start justify-between gap-4 mb-3">
                    <div class="flex items-center gap-3">
                      <span class="text-2xl leading-none">{{ phase.icon }}</span>
                      <div>
                        <div class="text-xs font-medium text-gray-500 uppercase tracking-wide">{{ phase.dateKey | translate }}</div>
                        <h3 class="text-lg font-bold text-white mt-0.5">{{ phase.titleKey | translate }}</h3>
                      </div>
                    </div>
                    <span class="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide"
                          [ngClass]="{
                            'bg-emerald-900/70 text-emerald-400': phase.status === 'done',
                            'bg-brand-900/70 text-brand-300': phase.status === 'active',
                            'bg-gray-800 text-gray-500': phase.status === 'upcoming'
                          }">
                      @if (phase.status === 'done') { {{ 'ROADMAP.STATUS_DONE' | translate }} ✓ }
                      @if (phase.status === 'active') { 🚀 {{ 'ROADMAP.STATUS_ACTIVE' | translate }} }
                      @if (phase.status === 'upcoming') { {{ 'ROADMAP.STATUS_UPCOMING' | translate }} }
                    </span>
                  </div>

                  <p class="text-sm text-gray-400 mb-4">{{ phase.subKey | translate }}</p>

                  <ul class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                    @for (fKey of phase.featureKeys; track fKey) {
                      <li class="flex items-start gap-2 text-sm">
                        <span class="flex-shrink-0 mt-0.5 font-bold"
                              [class.text-emerald-500]="phase.status === 'done'"
                              [class.text-brand-400]="phase.status === 'active'"
                              [class.text-gray-600]="phase.status === 'upcoming'">
                          @if (phase.status === 'done') { ✓ }
                          @if (phase.status === 'active') { › }
                          @if (phase.status === 'upcoming') { ○ }
                        </span>
                        <span [class.text-gray-200]="phase.status === 'done'"
                              [class.text-gray-100]="phase.status === 'active'"
                              [class.text-gray-500]="phase.status === 'upcoming'">{{ fKey | translate }}</span>
                      </li>
                    }
                  </ul>
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section id="faq" class="py-20 bg-white">
      <div class="container-custom max-w-4xl">
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
          <div class="flex items-center mb-2">
            <img src="logo-white.png" alt="Netrofit" style="height:60px" class="w-10" />
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
      <!-- Outer container scrolls on mobile so tall forms aren't cut off; sheet on phones, centered card on tablets+ -->
      <div class="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm"
           (click)="closeModal()">
        <div class="flex min-h-full items-end sm:items-center justify-center p-0 sm:p-4">
          <div class="bg-white shadow-2xl w-full max-w-lg p-5 pb-8 sm:p-8 rounded-t-2xl sm:rounded-2xl"
               (click)="$event.stopPropagation()">
          @if (submitted()) {
            <div class="text-center py-6">
              <div class="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-4xl mx-auto mb-4">✓</div>
              <h3 class="text-2xl font-bold text-gray-900 mb-2">{{ 'MODAL.SUCCESS_TITLE' | translate }}</h3>
              <p class="text-gray-600">{{ successMessage() }}</p>
              <button (click)="closeModal()" class="btn-primary mt-6">{{ 'MODAL.CLOSE' | translate }}</button>
            </div>
          } @else {
            <div class="flex justify-between items-start gap-3 mb-5">
              <div class="min-w-0">
                <h3 class="text-xl sm:text-2xl font-bold text-gray-900">{{ 'MODAL.TITLE' | translate }}</h3>
                <p class="text-sm text-gray-500 mt-1">{{ 'MODAL.SUB' | translate }}</p>
              </div>
              <button (click)="closeModal()" aria-label="Close"
                class="shrink-0 -mt-1 -mr-1 w-9 h-9 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-2xl leading-none">×</button>
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
      </div>
    }
  `,
})
export class LandingComponent {
  private demoLeadService = inject(DemoLeadService);
  private recaptcha = inject(RecaptchaService);
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
    { icon: '🔐', titleKey: 'BENEFITS.ITEMS.ROLES_TITLE', textKey: 'BENEFITS.ITEMS.ROLES_TEXT' },
  ];

  features: Feature[] = [
    { icon: '🏢', titleKey: 'FEATURES.ITEMS.MULTIBRANCH_TITLE',    textKey: 'FEATURES.ITEMS.MULTIBRANCH_TEXT',    category: 'operations' },
    { icon: '📊', titleKey: 'FEATURES.ITEMS.DASHBOARD_TITLE',      textKey: 'FEATURES.ITEMS.DASHBOARD_TEXT',      category: 'finance' },
    { icon: '🎓', titleKey: 'FEATURES.ITEMS.STUDENTS_TITLE',       textKey: 'FEATURES.ITEMS.STUDENTS_TEXT',       category: 'academics' },
    { icon: '📚', titleKey: 'FEATURES.ITEMS.COURSES_TITLE',        textKey: 'FEATURES.ITEMS.COURSES_TEXT',        category: 'academics' },
    { icon: '🎁', titleKey: 'FEATURES.ITEMS.BUNDLES_TITLE',        textKey: 'FEATURES.ITEMS.BUNDLES_TEXT',        category: 'academics' },
    { icon: '📅', titleKey: 'FEATURES.ITEMS.CLASSES_TITLE',        textKey: 'FEATURES.ITEMS.CLASSES_TEXT',        category: 'academics' },
    { icon: '🕘', titleKey: 'FEATURES.ITEMS.SESSIONS_TITLE',       textKey: 'FEATURES.ITEMS.SESSIONS_TEXT',       category: 'academics' },
    { icon: '🗓️', titleKey: 'FEATURES.ITEMS.TIMETABLE_TITLE',      textKey: 'FEATURES.ITEMS.TIMETABLE_TEXT',      category: 'academics' },
    { icon: '🚪', titleKey: 'FEATURES.ITEMS.ROOMS_TITLE',          textKey: 'FEATURES.ITEMS.ROOMS_TEXT',          category: 'academics' },
    { icon: '✅', titleKey: 'FEATURES.ITEMS.ATTENDANCE_TITLE',     textKey: 'FEATURES.ITEMS.ATTENDANCE_TEXT',     category: 'academics' },
    { icon: '👨‍🏫', titleKey: 'FEATURES.ITEMS.EMPLOYEES_TITLE',    textKey: 'FEATURES.ITEMS.EMPLOYEES_TEXT',      category: 'operations' },
    { icon: '💵', titleKey: 'FEATURES.ITEMS.PAYROLL_TITLE',        textKey: 'FEATURES.ITEMS.PAYROLL_TEXT',        category: 'operations' },
    { icon: '📝', titleKey: 'FEATURES.ITEMS.ENROLLMENTS_TITLE',    textKey: 'FEATURES.ITEMS.ENROLLMENTS_TEXT',    category: 'academics' },
    { icon: '💳', titleKey: 'FEATURES.ITEMS.INSTALLMENTS_TITLE',   textKey: 'FEATURES.ITEMS.INSTALLMENTS_TEXT',   category: 'finance' },
    { icon: '💰', titleKey: 'FEATURES.ITEMS.REVENUES_TITLE',       textKey: 'FEATURES.ITEMS.REVENUES_TEXT',       category: 'finance' },
    { icon: '🧾', titleKey: 'FEATURES.ITEMS.EXPENSES_TITLE',       textKey: 'FEATURES.ITEMS.EXPENSES_TEXT',       category: 'finance' },
    { icon: '🔁', titleKey: 'FEATURES.ITEMS.RECURRING_TITLE',      textKey: 'FEATURES.ITEMS.RECURRING_TEXT',      category: 'finance' },
    { icon: '↩️', titleKey: 'FEATURES.ITEMS.REFUNDS_TITLE',        textKey: 'FEATURES.ITEMS.REFUNDS_TEXT',        category: 'finance' },
    { icon: '🏧', titleKey: 'FEATURES.ITEMS.WITHDRAWALS_TITLE',    textKey: 'FEATURES.ITEMS.WITHDRAWALS_TEXT',    category: 'finance' },
    { icon: '📉', titleKey: 'FEATURES.ITEMS.DEBTS_TITLE',          textKey: 'FEATURES.ITEMS.DEBTS_TEXT',          category: 'finance' },
    { icon: '👛', titleKey: 'FEATURES.ITEMS.CASH_TITLE',           textKey: 'FEATURES.ITEMS.CASH_TEXT',           category: 'finance' },
    { icon: '📦', titleKey: 'FEATURES.ITEMS.INVENTORY_TITLE',      textKey: 'FEATURES.ITEMS.INVENTORY_TEXT',      category: 'commerce' },
    { icon: '🛒', titleKey: 'FEATURES.ITEMS.SALES_TITLE',          textKey: 'FEATURES.ITEMS.SALES_TEXT',          category: 'commerce' },
    { icon: '🚩', titleKey: 'FEATURES.ITEMS.EVENTS_TITLE',         textKey: 'FEATURES.ITEMS.EVENTS_TEXT',         category: 'commerce' },
    { icon: '📈', titleKey: 'FEATURES.ITEMS.ANALYTICS_TITLE',      textKey: 'FEATURES.ITEMS.ANALYTICS_TEXT',      category: 'insights' },
    { icon: '📑', titleKey: 'FEATURES.ITEMS.REPORTS_TITLE',        textKey: 'FEATURES.ITEMS.REPORTS_TEXT',        category: 'insights' },
    { icon: '🔒', titleKey: 'FEATURES.ITEMS.RBAC_TITLE',           textKey: 'FEATURES.ITEMS.RBAC_TEXT',           category: 'operations' },
    { icon: '🌍', titleKey: 'FEATURES.ITEMS.BILINGUAL_TITLE',      textKey: 'FEATURES.ITEMS.BILINGUAL_TEXT',      category: 'operations' },
  ];

  featureCategories: FeatureCategoryMeta[] = [
    { id: 'all',        labelKey: 'FEATURES.CATEGORIES.ALL',        icon: '✨' },
    { id: 'operations', labelKey: 'FEATURES.CATEGORIES.OPERATIONS', icon: '🏢' },
    { id: 'academics',  labelKey: 'FEATURES.CATEGORIES.ACADEMICS',  icon: '🎓' },
    { id: 'finance',    labelKey: 'FEATURES.CATEGORIES.FINANCE',    icon: '💰' },
    { id: 'commerce',   labelKey: 'FEATURES.CATEGORIES.COMMERCE',   icon: '🛒' },
    { id: 'insights',   labelKey: 'FEATURES.CATEGORIES.INSIGHTS',   icon: '📈' },
  ];

  activeFeatureCategory = signal<FeatureCategory | 'all'>('all');
  featureSearch = signal('');

  visibleFeatures = computed<Feature[]>(() => {
    const cat = this.activeFeatureCategory();
    const q = this.featureSearch().trim().toLowerCase();
    return this.features.filter(f => {
      if (cat !== 'all' && f.category !== cat) return false;
      if (!q) return true;
      const title = this.translate.instant(f.titleKey)?.toLowerCase() ?? '';
      const text = this.translate.instant(f.textKey)?.toLowerCase() ?? '';
      return title.includes(q) || text.includes(q);
    });
  });

  featureCountFor(id: FeatureCategory | 'all'): number {
    if (id === 'all') return this.features.length;
    return this.features.filter(f => f.category === id).length;
  }

  resetFeatureFilters(): void {
    this.activeFeatureCategory.set('all');
    this.featureSearch.set('');
  }

  roadmapPhases: RoadmapPhase[] = [
    {
      phase: '01', icon: '🏗️',
      dateKey: 'ROADMAP.PHASE_1_DATE', titleKey: 'ROADMAP.PHASE_1_TITLE', subKey: 'ROADMAP.PHASE_1_SUB',
      status: 'done',
      featureKeys: ['ROADMAP.PHASE_1_F1', 'ROADMAP.PHASE_1_F2', 'ROADMAP.PHASE_1_F3', 'ROADMAP.PHASE_1_F4'],
    },
    {
      phase: '02', icon: '⚙️',
      dateKey: 'ROADMAP.PHASE_2_DATE', titleKey: 'ROADMAP.PHASE_2_TITLE', subKey: 'ROADMAP.PHASE_2_SUB',
      status: 'done',
      featureKeys: ['ROADMAP.PHASE_2_F1', 'ROADMAP.PHASE_2_F2', 'ROADMAP.PHASE_2_F3', 'ROADMAP.PHASE_2_F4'],
    },
    {
      phase: '03', icon: '📊',
      dateKey: 'ROADMAP.PHASE_3_DATE', titleKey: 'ROADMAP.PHASE_3_TITLE', subKey: 'ROADMAP.PHASE_3_SUB',
      status: 'done',
      featureKeys: ['ROADMAP.PHASE_3_F1', 'ROADMAP.PHASE_3_F2', 'ROADMAP.PHASE_3_F3', 'ROADMAP.PHASE_3_F4'],
    },
    {
      phase: '04', icon: '🤖',
      dateKey: 'ROADMAP.PHASE_4_DATE', titleKey: 'ROADMAP.PHASE_4_TITLE', subKey: 'ROADMAP.PHASE_4_SUB',
      status: 'active',
      featureKeys: ['ROADMAP.PHASE_4_F1', 'ROADMAP.PHASE_4_F2', 'ROADMAP.PHASE_4_F3', 'ROADMAP.PHASE_4_F4'],
    },
    {
      phase: '05', icon: '🌐',
      dateKey: 'ROADMAP.PHASE_5_DATE', titleKey: 'ROADMAP.PHASE_5_TITLE', subKey: 'ROADMAP.PHASE_5_SUB',
      status: 'upcoming',
      featureKeys: ['ROADMAP.PHASE_5_F1', 'ROADMAP.PHASE_5_F2', 'ROADMAP.PHASE_5_F3', 'ROADMAP.PHASE_5_F4'],
    },
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
      starter: { monthly: 2000, annual: 1500 },
      growth: { monthly: 4000, annual: 3000 },
      pro: { monthly: 6800, annual: 5100 },
    };
    const sar = {
      starter: { monthly: 560, annual: 420 },
      growth: { monthly: 1120, annual: 840 },
      pro: { monthly: 1800, annual: 1350 },
    };
    const p = cur === 'EGP' ? egp : sar;

    const buildPlan = (
      tierKey: string,
      subtitleKey: string,
      sourceTag: string,
      tier: { monthly: number; annual: number },
      featureKeys: string[],
    ) => {
      const monthlyEquiv = isAnnual ? tier.annual : tier.monthly;
      const annualTotal = tier.annual * 12;
      const yearAtMonthly = tier.monthly * 12;
      const annualSavings = yearAtMonthly - annualTotal;
      const monthlySavings = tier.monthly - tier.annual;
      return {
        tierKey,
        subtitleKey,
        sourceTag,
        isCustom: false,
        ctaKey: 'PRICING.CTA',
        hintKey: '',
        price: monthlyEquiv,
        monthlyPrice: tier.monthly,
        annualMonthly: tier.annual,
        annualTotal,
        yearAtMonthly,
        annualSavings,
        monthlySavings,
        featureKeys,
      };
    };

    return [
      buildPlan('PRICING.PLANS.STARTER_TIER', 'PRICING.PLANS.STARTER_SUB', 'starter', p.starter, [
        'PRICING.PLANS.STARTER_FEAT_1',
        'PRICING.PLANS.STARTER_FEAT_2',
        'PRICING.PLANS.STARTER_FEAT_3',
        'PRICING.PLANS.STARTER_FEAT_4',
        'PRICING.PLANS.STARTER_FEAT_5',
      ]),
      buildPlan('PRICING.PLANS.GROWTH_TIER', 'PRICING.PLANS.GROWTH_SUB', 'growth', p.growth, [
        'PRICING.PLANS.GROWTH_FEAT_1',
        'PRICING.PLANS.GROWTH_FEAT_2',
        'PRICING.PLANS.GROWTH_FEAT_3',
        'PRICING.PLANS.GROWTH_FEAT_4',
        'PRICING.PLANS.GROWTH_FEAT_5',
      ]),
      buildPlan('PRICING.PLANS.PRO_TIER', 'PRICING.PLANS.PRO_SUB', 'pro', p.pro, [
        'PRICING.PLANS.PRO_FEAT_1',
        'PRICING.PLANS.PRO_FEAT_2',
        'PRICING.PLANS.PRO_FEAT_3',
        'PRICING.PLANS.PRO_FEAT_4',
        'PRICING.PLANS.PRO_FEAT_5',
      ]),
      // Custom / enterprise — no fixed price. Featured when a customer has
      // 1,200+ students, needs custom SLA, integrations, or white-label.
      {
        tierKey: 'PRICING.PLANS.ENTERPRISE_TIER',
        subtitleKey: 'PRICING.PLANS.ENTERPRISE_SUB',
        sourceTag: 'enterprise',
        isCustom: true,
        ctaKey: 'PRICING.CUSTOM_CTA_BTN',
        hintKey: 'PRICING.CUSTOM_HINT',
        price: 0,
        monthlyPrice: 0,
        annualMonthly: 0,
        annualTotal: 0,
        yearAtMonthly: 0,
        annualSavings: 0,
        monthlySavings: 0,
        featureKeys: [
          'PRICING.PLANS.ENTERPRISE_FEAT_1',
          'PRICING.PLANS.ENTERPRISE_FEAT_2',
          'PRICING.PLANS.ENTERPRISE_FEAT_3',
          'PRICING.PLANS.ENTERPRISE_FEAT_4',
          'PRICING.PLANS.ENTERPRISE_FEAT_5',
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

  async submit() {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);

    let recaptchaToken = '';
    try {
      recaptchaToken = await this.recaptcha.execute('demo_lead');
    } catch (err) {
      console.error('reCAPTCHA execute failed:', err);
    }

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
        recaptchaToken: recaptchaToken || undefined,
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
