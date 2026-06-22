import { Injectable, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  WhatsappTemplateType,
} from '../utils/whatsapp.util';

type TemplateMap = Record<string, string>;

/**
 * Loads and caches the company's editable click-to-chat templates.
 * `get()` returns the cached body (or the built-in default) synchronously so
 * buttons can build their message at click time.
 */
@Injectable({ providedIn: 'root' })
export class WhatsappTemplatesService {
  private api = inject(ApiService);
  private cache$?: Observable<TemplateMap>;
  /** Latest known templates; null until first load resolves. */
  readonly templates = signal<TemplateMap | null>(null);

  /** Cached fetch — safe to call from multiple components; shares one request. */
  load(): Observable<TemplateMap> {
    if (!this.cache$) {
      this.cache$ = this.api.get<{ templates: TemplateMap }>('whatsapp/templates').pipe(
        map((r) => r.templates),
        tap((t) => this.templates.set(t)),
        shareReplay(1),
      );
    }
    return this.cache$;
  }

  /** Synchronous best-effort body: stored value, else the built-in default. */
  get(type: WhatsappTemplateType): string {
    return this.templates()?.[type] ?? DEFAULT_WHATSAPP_TEMPLATES[type];
  }

  update(templates: TemplateMap): Observable<TemplateMap> {
    return this.api.put<{ templates: TemplateMap }>('whatsapp/templates', { templates }).pipe(
      map((r) => r.templates),
      tap((t) => {
        this.templates.set(t);
        this.cache$ = of(t);
      }),
    );
  }
}
