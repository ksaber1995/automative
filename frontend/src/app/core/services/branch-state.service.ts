import { Injectable, inject, signal, computed } from '@angular/core';
import { BranchService } from '../../features/branches/services/branch.service';
import { Branch } from '@shared/interfaces/branch.interface';

/**
 * App-wide cache of the company's active branches plus the derived
 * "single branch" state. When a company/teacher has exactly one branch we
 * preselect it in every form dropdown and hide every branch filter, so the
 * user never has to deal with a branch picker that has only one choice.
 *
 * Loads lazily on first injection (always behind the auth guard) and caches
 * the result. Components read the signals; nothing else needs to load it.
 */
@Injectable({ providedIn: 'root' })
export class BranchStateService {
  private branchService = inject(BranchService);

  private _branches = signal<Branch[]>([]);
  private loaded = false;

  /** All active branches for the current company (cached). */
  readonly branches = this._branches.asReadonly();

  /** True once branches have been loaded and the company has exactly one. */
  readonly isSingleBranch = computed(() => this._branches().length === 1);

  /** The only branch when {@link isSingleBranch}, otherwise null. */
  readonly onlyBranch = computed<Branch | null>(() =>
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
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => this._branches.set(branches),
      error: () => {
        // Interceptor toasted the translated error; allow a later retry.
        this.loaded = false;
      },
    });
  }
}
