import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../core/services/language.service';

export interface BreadcrumbItem {
  label: string;
  link: string | null;
}

/**
 * Crumb factory shape supported in route data.breadcrumb.
 *
 * - `string`        : either a plain label or an i18n key (auto-detected: keys
 *                     match the pattern of "ALL_CAPS.WITH.DOTS" or
 *                     "BREADCRUMBS.*"). Translated when found, used verbatim
 *                     otherwise.
 * - `(args) => Item`: dynamic crumb. Receives the matched route's params and
 *                     can return a custom label and a custom link.
 */
type BreadcrumbDataValue =
  | string
  | ((args: { params: Record<string, string>; data: Record<string, any> }) => BreadcrumbItem | string);

@Component({
  selector: 'app-breadcrumbs',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule],
  template: `
    @if (items().length > 1) {
      <nav class="breadcrumbs flex items-center gap-1.5 text-sm text-gray-500 mb-4 flex-wrap" aria-label="Breadcrumb">
        @for (crumb of items(); track $index; let last = $last) {
          @if (!last && crumb.link) {
            <a [routerLink]="crumb.link"
               class="hover:text-blue-600 transition-colors font-medium">{{ crumb.label }}</a>
          } @else {
            <span [class]="last ? 'text-gray-900 font-semibold' : 'font-medium'">{{ crumb.label }}</span>
          }
          @if (!last) {
            <i class="pi text-xs text-gray-300"
               [class.pi-angle-right]="!isRtl()"
               [class.pi-angle-left]="isRtl()"></i>
          }
        }
      </nav>
    }
  `,
})
export class BreadcrumbsComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);
  private languageService = inject(LanguageService);

  items = signal<BreadcrumbItem[]>([]);
  isRtl = () => this.languageService.isRtl();

  constructor() {
    // Recompute on navigation end so per-route data is freshly resolved.
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => this.items.set(this.build()));

    // First paint (in case the component mounts after the initial navigation).
    this.items.set(this.build());

    // Also rebuild on language change so labels follow the active locale.
    this.translate.onLangChange.subscribe(() => this.items.set(this.build()));
  }

  private build(): BreadcrumbItem[] {
    const root = this.route.root;
    const crumbs: BreadcrumbItem[] = [];
    const urlSegments: string[] = [];
    const seen = new Set<string>();

    const walk = (node: ActivatedRoute) => {
      const snapshot = node.snapshot;
      if (!snapshot) return;
      // Append URL segments of this route to the cumulative path.
      const segs = snapshot.url.map(u => u.path).filter(Boolean);
      if (segs.length) urlSegments.push(...segs);

      const crumbData: BreadcrumbDataValue | undefined = snapshot.data?.['breadcrumb'];
      if (crumbData !== undefined) {
        const linkSoFar = '/' + urlSegments.join('/');
        const params = snapshot.params || {};
        let item: BreadcrumbItem;

        if (typeof crumbData === 'function') {
          const result = crumbData({ params, data: snapshot.data });
          item = typeof result === 'string'
            ? { label: this.resolveLabel(result), link: linkSoFar }
            : { label: this.resolveLabel(result.label), link: result.link ?? linkSoFar };
        } else {
          item = { label: this.resolveLabel(crumbData), link: linkSoFar };
        }

        // De-dupe consecutive identical links (parent + index child often share a URL).
        const key = item.link + '|' + item.label;
        if (!seen.has(key)) {
          seen.add(key);
          crumbs.push(item);
        }
      }

      for (const child of node.children) walk(child);
    };

    walk(root);

    // Last crumb has no clickable link (it's the current page).
    if (crumbs.length) crumbs[crumbs.length - 1] = { ...crumbs[crumbs.length - 1], link: null };
    return crumbs;
  }

  /**
   * Resolve a label string. Strings that look like i18n keys (uppercase + dots)
   * are translated; everything else is used verbatim.
   */
  private resolveLabel(value: string): string {
    if (!value) return '';
    const looksLikeKey = /^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+$/.test(value);
    if (!looksLikeKey) return value;
    const translated = this.translate.instant(value);
    // ngx-translate returns the key when the translation is missing.
    return translated === value ? value : translated;
  }
}
