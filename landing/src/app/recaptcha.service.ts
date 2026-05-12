import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

/**
 * Loads Google reCAPTCHA v3 on demand and returns short-lived action tokens.
 *
 * The site key comes from `environment.recaptchaSiteKey`. When the key is
 * unset (dev) the service is a no-op — calls to `execute()` resolve to an
 * empty string and the backend skips verification.
 */
@Injectable({ providedIn: 'root' })
export class RecaptchaService {
  private loaderPromise: Promise<void> | null = null;

  async execute(action: string): Promise<string> {
    const siteKey = environment.recaptchaSiteKey;
    if (!siteKey) return '';

    await this.ensureLoaded(siteKey);

    return new Promise<string>((resolve, reject) => {
      const grecaptcha = window.grecaptcha;
      if (!grecaptcha) {
        resolve('');
        return;
      }
      grecaptcha.ready(() => {
        grecaptcha.execute(siteKey, { action }).then(resolve, reject);
      });
    });
  }

  private ensureLoaded(siteKey: string): Promise<void> {
    if (this.loaderPromise) return this.loaderPromise;
    this.loaderPromise = new Promise<void>((resolve, reject) => {
      if (window.grecaptcha) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load reCAPTCHA'));
      document.head.appendChild(script);
    });
    return this.loaderPromise;
  }
}
