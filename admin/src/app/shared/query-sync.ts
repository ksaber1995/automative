import { effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * One filter control, tied to one query-string key.
 *
 * Deliberately string-in / string-out rather than generic: the pages bind
 * strings, booleans and small unions, and a lambda pair at each call site reads
 * better than the type gymnastics needed to cover all three.
 */
export interface QueryBinding {
  /** The key as it appears in the URL. Keep them short — people read these. */
  key: string;
  /** Current value for the URL. Return null to leave the key out entirely. */
  get: () => string | null;
  /** Apply a value from the URL. null means the key was absent. */
  set: (value: string | null) => void;
}

/**
 * Keep a page's search and filters in the address bar.
 *
 * Sections became routes so a reload would stay put, which fixed the section but
 * not the state inside it: refreshing a filtered, searched table still dropped
 * you back to the unfiltered default. The URL is now the whole answer, so a view
 * can be reloaded, bookmarked, or pasted to someone else.
 *
 * Order matters. Seeding from the snapshot happens FIRST, so the signals already
 * hold the URL's values before the effect below runs — otherwise the effect's
 * first pass would write the defaults over whatever was in the link that was
 * just opened.
 *
 * Writes use `replaceUrl`, so typing in a search box does not push a history
 * entry per keystroke; and `merge`, so a page can own some keys without
 * clobbering others on the same URL (the Cards sheet's `client` lives beside
 * these).
 *
 * Must be called from an injection context — a constructor or a field
 * initialiser — because it uses `inject`, `effect` and `takeUntilDestroyed`.
 */
export function syncQueryParams(bindings: QueryBinding[]): void {
  const route = inject(ActivatedRoute);
  const router = inject(Router);

  for (const b of bindings) {
    const initial = route.snapshot.queryParamMap.get(b.key);
    if (initial !== null) b.set(initial);
  }

  // Back, forward, or a link into this page carrying different filters.
  route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
    for (const b of bindings) b.set(params.get(b.key));
  });

  // Signals → URL.
  //
  // The guard is what makes a loop impossible rather than merely unlikely.
  // Writing the URL re-emits queryParamMap, which writes the signals back; if a
  // binding did not round-trip exactly — `get` trims, say, where `set` does not
  // — that would schedule another write, and another. Comparing against the URL
  // that is already there means the cycle stops as soon as it agrees, whatever
  // the bindings do in between.
  effect(() => {
    const queryParams: Record<string, string | null> = {};
    for (const b of bindings) queryParams[b.key] = b.get();

    const current = route.snapshot.queryParamMap;
    const differs = bindings.some((b) => (current.get(b.key) ?? null) !== queryParams[b.key]);
    if (!differs) return;

    router.navigate([], {
      relativeTo: route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });
}

/** `?flag=1` when on, absent when off — reads better than `flag=false`. */
export function boolParam(value: boolean, whenDefault: boolean): string | null {
  return value === whenDefault ? null : value ? '1' : '0';
}

/** The other half of boolParam: an absent key falls back to the default. */
export function readBool(value: string | null, whenDefault: boolean): boolean {
  if (value === null) return whenDefault;
  return value === '1' || value === 'true';
}
