import { Injectable, inject } from '@angular/core';
import { Router, NavigationStart, NavigationError } from '@angular/router';

/** Re-check cadence while the tab stays open. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
/** Don't re-check more often than this on tab-switch churn. */
const VISIBILITY_THROTTLE_MS = 5 * 60 * 1000;
/** Loop guard: remember which release we already force-reloaded for. */
const RELOADED_FOR_KEY = 'netrofit-update-reloaded-for';

/**
 * Detects that the running app is older than the deployed one, and heals it
 * without asking the user to refresh anything.
 *
 * Why this exists: index.html was historically uploaded with no Cache-Control
 * header, so browsers cached it heuristically and some phones kept booting a
 * release-old app for days. The deploy now ships must-revalidate headers, but
 * a header can only reach a browser that re-fetches — this service is the arm
 * that reaches the ones that don't.
 *
 * How staleness is detected: the running document's own <script src="main-HASH.js">
 * is compared against the one in a freshly fetched (cache-bypassed) index.html.
 * The hash changes on every release, so a mismatch means "this tab is running
 * old code". Comparing DOM-vs-network is the load-bearing part: comparing two
 * network fetches would never notice that the *booted* app is the stale one.
 * In dev builds the bundle is an unhashed main.js on both sides, so the check
 * never fires there.
 *
 * When to reload — never under the user's feet:
 *  - mismatch on the boot-time check: reload immediately (nothing typed yet),
 *    once per release (sessionStorage guard, in case something upstream keeps
 *    serving the old shell and a loop would otherwise spin);
 *  - mismatch later: wait for a safe moment — the tab going hidden, or the
 *    next route navigation, which is turned into a full page load so the new
 *    index.html comes along for free.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private router = inject(Router);
  private updateAvailable = false;
  private lastCheck = 0;
  private started = false;

  start() {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;

    // Boot check: if this very page load came from a stale index.html, heal now.
    this.check(/* justBooted */ true);

    setInterval(() => this.check(false), CHECK_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Nobody is looking — the free moment to swap releases.
        if (this.updateAvailable) window.location.reload();
      } else if (Date.now() - this.lastCheck > VISIBILITY_THROTTLE_MS) {
        // Coming back to a long-lived tab is exactly when it's likely stale.
        this.check(false);
      }
    });

    // A pending update rides the next navigation: let the router move, then
    // reload at the new URL so the SPA transition becomes a real page load.
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart && this.updateAvailable) {
        this.updateAvailable = false;
        setTimeout(() => window.location.reload());
      }
      // A lazy chunk that fails to load IS the staleness signal, arriving
      // before any periodic check could: the release this tab booted from is
      // gone, so its route click 404s and the navigation silently dies —
      // "the page is unresponsive". Turn that exact failure into a full page
      // load at the URL the user asked for; the fresh index.html brings the
      // matching chunks. Guarded per-URL so a genuinely broken build cannot
      // reload-loop.
      if (e instanceof NavigationError && this.isChunkLoadFailure(e.error)) {
        const key = `netrofit-chunkfail-reloaded:${e.url}`;
        if (sessionStorage.getItem(key) !== this.runningMainBundle()) {
          sessionStorage.setItem(key, this.runningMainBundle() ?? 'unknown');
          window.location.assign(e.url);
        }
      }
    });
  }

  private async check(justBooted: boolean) {
    this.lastCheck = Date.now();
    const running = this.runningMainBundle();
    if (!running) return; // unexpected document shape — never reload on a guess

    let deployed: string | null = null;
    try {
      // no-store bypasses the very browser cache that caused the staleness.
      const res = await fetch(new URL('index.html', document.baseURI), { cache: 'no-store' });
      if (!res.ok) return;
      deployed = this.mainBundleOf(await res.text());
    } catch {
      return; // offline — try again on the next trigger
    }
    if (!deployed || deployed === running) return;

    if (justBooted) {
      // Fresh page, nothing to lose — but only once per target release, so a
      // stubbornly stale shell can't cause a reload loop.
      if (sessionStorage.getItem(RELOADED_FOR_KEY) !== deployed) {
        sessionStorage.setItem(RELOADED_FOR_KEY, deployed);
        window.location.reload();
        return;
      }
    }
    this.updateAvailable = true;
    if (document.hidden) window.location.reload();
  }

  /** A failed dynamic import of a route chunk, in every browser's phrasing. */
  private isChunkLoadFailure(error: unknown): boolean {
    const text = `${(error as any)?.name ?? ''} ${(error as any)?.message ?? error ?? ''}`;
    return /ChunkLoadError|Loading chunk|dynamically imported module|error loading|import\(\) failed|Importing a module script failed/i.test(text);
  }

  /** The main bundle this tab actually booted from. */
  private runningMainBundle(): string | null {
    for (const s of Array.from(document.scripts)) {
      const src = s.getAttribute('src');
      if (src && /(^|\/)main[^/]*\.js$/.test(src)) return src;
    }
    return null;
  }

  /** The main bundle a given index.html would boot. */
  private mainBundleOf(html: string): string | null {
    const m = html.match(/<script[^>]+src="([^"]*main[^"/]*\.js)"/);
    return m ? m[1] : null;
  }
}
