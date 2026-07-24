import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { PoolBarComponent } from './pool-bar.component';
import { ClientRow } from './models';

/**
 * Slide-over detail panel for one client. Rendered whenever `client` is non-null;
 * the host owns opening/closing so the table stays a dumb list.
 */
@Component({
  selector: 'app-client-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, PoolBarComponent],
  host: { '(document:keydown.escape)': 'close.emit()' },
  template: `
    @if (client(); as c) {
      <div class="overlay open" (click)="close.emit()"></div>
      <aside class="drawer open" role="dialog" aria-modal="true" [attr.aria-label]="c.name">
        <div class="drawer-head">
          <div>
            <h2>{{ c.name }}</h2>
            <div class="meta">
              <span class="badge">{{ c.type }}</span>
              <span>{{ c.subType || '—' }} subscription</span>
              @if (!c.enabled) { <span class="off">· pool off</span> }
            </div>
          </div>
          <button class="x" aria-label="Close" (click)="close.emit()">×</button>
        </div>

        <div class="drawer-body">
          <div class="sec">
            <h3>QR pool</h3>
            <dl class="kv">
              <dt>Total cards</dt><dd>{{ c.total | number }}</dd>
              <dt>Linked</dt>
              <dd>{{ c.linked | number }}@if (c.total) { ({{ linkedPct() }}%) }</dd>
              <dt>Unlinked</dt><dd>{{ c.unlinked | number }}</dd>
              <dt>Pool enabled</dt><dd>{{ c.enabled ? 'Yes' : 'No' }}</dd>
            </dl>
            @if (c.total) {
              <app-pool-bar [linked]="c.linked" [unlinked]="c.unlinked" />
              <div class="legend">
                <span><span class="dot l"></span>Linked</span>
                <span><span class="dot u"></span>Unlinked</span>
              </div>
            } @else {
              <div class="off" style="font-size:13px">No cards generated yet.</div>
            }
          </div>

          <div class="sec">
            <h3>Subscription</h3>
            <dl class="kv">
              <dt>Status</dt><dd>{{ c.subType || '—' }}</dd>
              <dt>Price</dt>
              <dd>@if (c.price != null) { {{ c.price | number }}{{ c.currency ? ' ' + c.currency : '' }} } @else { — }</dd>
              <dt>Started</dt><dd>{{ (c.startDate | date: 'mediumDate') || '—' }}</dd>
              <dt>Ends</dt><dd>{{ (c.endDate | date: 'mediumDate') || '—' }}</dd>
            </dl>
          </div>

          <div class="sec">
            <h3>Account</h3>
            <dl class="kv">
              <dt>Owner email</dt>
              <dd>
                @if (c.ownerEmail) {
                  <a class="link" [href]="'mailto:' + c.ownerEmail">{{ c.ownerEmail }}</a>
                } @else { — }
              </dd>
              <dt>Mobile</dt><dd>{{ c.mobile || '—' }}</dd>
              <dt>Client since</dt><dd>{{ (c.createdAt | date: 'mediumDate') || '—' }}</dd>
            </dl>
          </div>

          <div class="sec">
            <h3>Usage</h3>
            <dl class="kv">
              <dt>Students</dt><dd>{{ c.students | number }}</dd>
              <dt>Courses</dt><dd>{{ c.courses | number }}</dd>
              <dt>Branches</dt><dd>{{ c.branches | number }}</dd>
              <dt>Employees</dt><dd>{{ c.employees | number }}</dd>
            </dl>
          </div>
        </div>
      </aside>
    }
  `,
  styles: [`
    .overlay {
      position: fixed; inset: 0; background: rgba(11,11,11,0.38);
      opacity: 0; visibility: hidden; transition: opacity .16s ease; z-index: 40;
    }
    .overlay.open { opacity: 1; visibility: visible; }
    .drawer {
      position: fixed; top: 0; right: 0; height: 100%; width: 420px; max-width: 92vw;
      background: var(--surface); border-left: 1px solid var(--border);
      box-shadow: -8px 0 32px rgba(11,11,11,0.18);
      transform: translateX(100%); transition: transform .2s ease; z-index: 50;
      display: flex; flex-direction: column;
    }
    .drawer.open { transform: translateX(0); }
    .drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 20px 22px 14px; border-bottom: 1px solid var(--grid); }
    .drawer-head h2 { font-size: 17px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
    .drawer-head .meta { color: var(--text-2); font-size: 12.5px; margin-top: 4px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .x { border: none; background: transparent; color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
    .x:hover { color: var(--text); background: color-mix(in srgb, var(--muted) 14%, transparent); }
    .drawer-body { overflow-y: auto; padding: 6px 22px 26px; }
    .sec { margin-top: 18px; }
    .sec h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 0 0 8px; }
    .kv { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; font-size: 13.5px; margin: 0; }
    .kv dt { color: var(--text-2); }
    .kv dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
    app-pool-bar { display: block; margin-top: 4px; }
    .legend { margin-top: 8px; }
  `],
})
export class ClientDrawerComponent {
  /** null closes the drawer. */
  client = input.required<ClientRow | null>();
  close = output<void>();

  protected linkedPct = computed(() => {
    const c = this.client();
    return c && c.total ? Math.round((c.linked / c.total) * 100) : 0;
  });
}
