import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The linked/unlinked split bar. Used three times at different sizes: the global
 * pool summary, the inline bar in each table row, and the one in the detail
 * sheet — hence the `compact` input rather than three near-identical bars.
 */
@Component({
  selector: 'app-pool-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="poolbar" [class.compact]="compact()">
      <i class="l" [style.width.%]="linkedPct()" [title]="'Linked: ' + linked().toLocaleString()"></i>
      <i class="u" [style.width.%]="100 - linkedPct()" [title]="'Unlinked: ' + unlinked().toLocaleString()"></i>
    </div>
  `,
  styles: [`
    .poolbar { display: flex; height: 16px; border-radius: 5px; overflow: hidden; gap: 2px; background: transparent; }
    .poolbar i { display: block; height: 100%; }
    .poolbar i.l { background: var(--linked); border-radius: 5px 2px 2px 5px; }
    .poolbar i.u { background: var(--unlinked); border-radius: 2px 5px 5px 2px; }

    /* Row-level version: small enough to sit inline in a table cell. */
    .poolbar.compact { display: inline-flex; height: 8px; width: 90px; vertical-align: middle; border-radius: 4px; }
  `],
})
export class PoolBarComponent {
  linked = input.required<number>();
  unlinked = input.required<number>();
  compact = input(false);

  /** An empty pool renders as fully unlinked rather than dividing by zero. */
  protected linkedPct = computed(() => {
    const total = this.linked() + this.unlinked();
    return total > 0 ? (this.linked() / total) * 100 : 0;
  });
}
