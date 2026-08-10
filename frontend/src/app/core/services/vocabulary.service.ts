import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TranslateService, TranslationObject } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { CompanyVertical } from '@shared/interfaces/user.interface';
// Type-only: LanguageService imports nothing from here, and a value import would
// make the two modules circular at runtime.
import type { AppLanguage } from './language.service';

/**
 * The words a tenant sees, on top of the words everyone sees.
 *
 * A sports academy runs on exactly the same features as an advanced academy —
 * same tables, same permissions, same CRM and Cash — but calls its people
 * coaches and trainees, who train in groups on a pitch. That is a vocabulary,
 * not a fork.
 *
 * So `assets/i18n/en.json` stays the one source of truth and
 * `assets/i18n/en.sports.json` carries ONLY the keys whose wording differs.
 * ngx-translate deep-merges the overlay over the base, so a key nobody
 * translated falls through to the general wording instead of rendering as a raw
 * key — and the ~95% of the app that says the same thing either way cannot drift
 * between two copies.
 *
 * The overlay has to be re-applied on every language switch, because
 * `translate.use()` reloads that language from the loader and the merge is lost.
 */
@Injectable({ providedIn: 'root' })
export class VocabularyService {
  private http = inject(HttpClient);
  private translate = inject(TranslateService);

  /** GENERAL until login says otherwise; nothing is overlaid for it. */
  private vertical: CompanyVertical = 'GENERAL';

  /** Overlays already fetched, keyed `${vertical}:${lang}` — each is fetched once. */
  private cache = new Map<string, TranslationObject>();

  constructor() {
    // Switching language reloads that language's file from the loader, which
    // throws the merge away — so the overlay is re-applied every time the
    // language settles. Listening here rather than in LanguageService means
    // nothing has to remember to call us.
    this.translate.onLangChange.subscribe((e) => { void this.applyTo(e.lang as AppLanguage); });
  }

  /**
   * Point the app at a tenant's vocabulary and apply it to the current language.
   * Called after login and on the app's startup restore.
   */
  async use(vertical: CompanyVertical): Promise<void> {
    this.vertical = vertical;
    await this.applyTo(this.translate.getCurrentLang() as AppLanguage);
  }

  /** Back to the general wording — on logout, so the next tenant starts clean. */
  reset(): void {
    this.vertical = 'GENERAL';
  }

  /**
   * Merge the overlay for `lang`, if this tenant has one.
   *
   * A missing or unparseable overlay file is not an error worth showing anyone:
   * the app then simply speaks the general vocabulary, which is readable and
   * correct in every respect except the words. Failing loudly here would break
   * login over a cosmetic asset.
   */
  async applyTo(lang: AppLanguage): Promise<void> {
    if (this.vertical === 'GENERAL' || !lang) return;
    const key = `${this.vertical}:${lang}`;
    let overlay = this.cache.get(key);
    if (!overlay) {
      try {
        overlay = await firstValueFrom(
          this.http.get<TranslationObject>(`./assets/i18n/${lang}.${this.vertical.toLowerCase()}.json`),
        );
        this.cache.set(key, overlay);
      } catch {
        return;
      }
    }
    // `true` is the merge flag — without it this REPLACES the language's whole
    // dictionary with the handful of keys in the overlay and the rest of the app
    // renders as raw translation keys.
    this.translate.setTranslation(lang, overlay, true);
  }
}
