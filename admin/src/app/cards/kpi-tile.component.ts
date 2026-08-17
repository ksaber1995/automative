import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** One headline number with a caption underneath. */
@Component({
  selector: 'app-kpi-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="kpi">
      <div class="label">{{ label() }}</div>
      <div class="value">{{ value() }}</div>
      <div class="note">{{ note() }}</div>
    </div>
  `,
  styles: [`
    .kpi {
      background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
      padding: 16px 18px; box-shadow: var(--shadow); height: 100%;
    }
    .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .value { font-size: 30px; font-weight: 650; margin-top: 6px; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .note { color: var(--text-2); font-size: 12px; margin-top: 2px; min-height: 1.2em; }
  `],
})
export class KpiTileComponent {
  label = input.required<string>();
  value = input.required<string>();
  note = input('');
}
