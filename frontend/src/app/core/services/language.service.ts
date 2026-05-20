import { Injectable, signal, computed, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { PrimeNG } from 'primeng/config';

export type AppLanguage = 'en' | 'ar';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private translate = inject(TranslateService);
  private primeng = inject(PrimeNG);

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
    this.applyPrimeNGTranslation(lang);
  }

  // PrimeNG components (confirm/delete dialogs, file upload, calendars…) ship
  // with English defaults. We swap them when the user toggles language so
  // "Yes/No", "Cancel", "Today" etc. follow the rest of the UI.
  private applyPrimeNGTranslation(lang: AppLanguage) {
    if (lang === 'ar') {
      this.primeng.setTranslation({
        accept: 'نعم',
        reject: 'لا',
        cancel: 'إلغاء',
        clear: 'مسح',
        apply: 'تطبيق',
        choose: 'اختيار',
        upload: 'رفع',
        today: 'اليوم',
        weekHeader: 'أسبوع',
        emptyMessage: 'لا توجد نتائج',
        emptyFilterMessage: 'لا توجد نتائج للبحث',
        dayNames: ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'],
        dayNamesShort: ['أحد','إثن','ثلا','أرب','خمي','جمع','سبت'],
        dayNamesMin: ['ح','ن','ث','ر','خ','ج','س'],
        monthNames: ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],
        monthNamesShort: ['ينا','فبر','مار','أبر','ماي','يون','يول','أغس','سبت','أكت','نوف','ديس'],
      });
    } else {
      this.primeng.setTranslation({
        accept: 'Yes',
        reject: 'No',
        cancel: 'Cancel',
        clear: 'Clear',
        apply: 'Apply',
        choose: 'Choose',
        upload: 'Upload',
        today: 'Today',
        weekHeader: 'Wk',
        emptyMessage: 'No results found',
        emptyFilterMessage: 'No results found',
        dayNames: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
        dayNamesShort: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
        dayNamesMin: ['S','M','T','W','T','F','S'],
        monthNames: ['January','February','March','April','May','June','July','August','September','October','November','December'],
        monthNamesShort: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
      });
    }
  }
}
