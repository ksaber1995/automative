import { Injectable, signal, computed, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export type AppLanguage = 'en' | 'ar';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private translate = inject(TranslateService);

  currentLang = signal<AppLanguage>(
    (localStorage.getItem('app_lang') as AppLanguage) || 'en'
  );

  isRtl = computed(() => this.currentLang() === 'ar');

  constructor() {
    this.apply(this.currentLang());
  }

  toggle() {
    this.setLanguage(this.currentLang() === 'en' ? 'ar' : 'en');
  }

  setLanguage(lang: AppLanguage) {
    this.currentLang.set(lang);
    this.apply(lang);
    localStorage.setItem('app_lang', lang);
  }

  private apply(lang: AppLanguage) {
    this.translate.use(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }
}
