import { Injectable, inject, signal, computed } from '@angular/core';
import { LookupService, LookupOption } from './lookup.service';

/**
 * App-wide cache of the company's active branches plus the derived
 * "single branch" state. When a company/teacher has exactly one branch we
 * preselect it in every form dropdown and hide every branch filter, so the
 * user never has to deal with a branch picker that has only one choice.
 *
 * Uses the permission-free lookups endpoint (id + label only): this service is
 * constructed on essentially every page, so it must NOT require the `branches`
 * permission — otherwise a user who can see Courses but not Branches would get a
 * 403 just for visiting /courses.
 *
 * Loads lazily on first injection (always behind the auth guard) and caches
 * the result. Components read the signals; nothing else needs to load it.
 */
@Injectable({ providedIn: 'root' })
export class BranchStateService {
  private lookupService = inject(LookupService);

  private static readonly MAX_RETRIES = 2;
  private static readonly RETRY_DELAY_MS = 3000;

  private _branches = signal<LookupOption[]>([]);
  private _ready = signal(false);
  private loaded = false;
  private retries = 0;

  /** All active branches for the current company (cached, {id, label}). */
  readonly branches = this._branches.asReadonly();

  /**
   * Has the answer arrived? An empty list means "no branches" only once this is
   * true — before that it means "not back yet", and the two must not be read the
   * same way. A form that treats the loading state as "several branches, none of
   * them known" shows a required branch picker with nothing in it.
   */
  readonly ready = this._ready.asReadonly();

  /** True once branches have been loaded and the company has exactly one. */
  readonly isSingleBranch = computed(() => this._branches().length === 1);

  /**
   * Should a branch control be on screen at all? Only when the list is back AND
   * it holds a real choice.
   *
   * Every branch picker and branch filter in the app is gated on this rather
   * than on `!isSingleBranch()`. The difference is the loading state: an empty
   * list is not one branch, so the old test said "show it" while the request was
   * still in flight, and a required picker rendered with nothing to pick. Read
   * it as a question about what to show, not as a fact about the company.
   */
  readonly showBranchPicker = computed(() => this._ready() && this._branches().length > 1);

  /** The only branch when {@link isSingleBranch}, otherwise null. */
  readonly onlyBranch = computed<LookupOption | null>(() =>
    this._branches().length === 1 ? this._branches()[0] : null,
  );

  /** The only branch id when {@link isSingleBranch}, otherwise null. */
  readonly onlyBranchId = computed<string | null>(() => this.onlyBranch()?.id ?? null);

  constructor() {
    this.load();
  }

  /** Load active branches once and cache. Safe to call repeatedly. */
  load(force = false): void {
    if (this.loaded && !force) return;
    this.loaded = true;
    this.lookupService.branches().subscribe({
      next: (branches) => {
        this._branches.set(branches);
        this._ready.set(true);
      },
      error: () => {
        // Interceptor toasted the translated error; allow a later retry.
        this.loaded = false;
        // And take one: the constructor fires this request once per session, so
        // a single failure — a cold start that timed out, a connection that
        // dropped — used to leave every branch control in the tab reading off an
        // empty list until the page was reloaded. Twice, spaced out, then stop:
        // a permanent failure is the interceptor's story to tell, not a retry
        // loop's.
        if (this.retries < BranchStateService.MAX_RETRIES) {
          this.retries++;
          setTimeout(() => this.load(), BranchStateService.RETRY_DELAY_MS);
        }
      },
    });
  }

  /**
   * Load if the first attempt never landed. The constructor fires exactly one
   * request per session, so a single failed one — a cold start that timed out, a
   * dropped connection — used to leave every branch dropdown in the app empty
   * until the tab was reloaded, with nothing left to trigger a retry.
   *
   * Call it from any page that needs the branch list to be right.
   */
  ensureLoaded(): void {
    if (!this._ready()) this.load();
  }
}
