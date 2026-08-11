import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { PoolBarComponent } from './pool-bar.component';
import { ClientRow, SortKey, SortState } from './models';

/** One sortable column header. */
interface Column {
  key: SortKey | null;
  label: string;
  numeric: boolean;
}

@Component({
  selector: 'app-client-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, PoolBarComponent],
  template: `
    <div class="card">
      <div class="tscroll">
        <table>
          <thead>
            <tr>
              @for (col of columns; track col.label) {
                <th
                  [class.num]="col.numeric"
                  [class.sortable]="col.key"
                  (click)="col.key && sortBy.emit(col.key)"
                >
                  {{ col.label }}
                  @if (col.key && col.key === sort().key) {
                    <span class="arrow">{{ sort().dir < 0 ? '▼' : '▲' }}</span>
                  }
                </th>
              }
            </tr>
          </thead>

          <tbody>
            @for (r of rows(); track r.id) {
              <tr
                class="rowlink"
                tabindex="0"
                [title]="'View ' + r.name + ' details'"
                (click)="select.emit(r)"
                (keydown.enter)="select.emit(r)"
                (keydown.space)="$event.preventDefault(); select.emit(r)"
              >
                <td class="name">{{ r.name }}</td>
                <td>
                  <span class="badge">{{ r.type }}</span>
                  @if (!r.enabled) { <span class="off" title="QR pool disabled"> off</span> }
                </td>
                <td class="num">{{ r.activeStudents | number }}</td>
                <td class="num">{{ r.total | number }}</td>
                <td class="num">{{ r.linked | number }}</td>
                <td class="num">{{ r.unlinked | number }}</td>
                <td>
                  @if (r.total) {
                    <app-pool-bar [linked]="r.linked" [unlinked]="r.unlinked" [compact]="true" />
                  } @else {
                    <span class="off">—</span>
                  }
                </td>
                <td class="addr" [title]="r.address || 'No address set'">
                  @if (r.address) { {{ r.address }} } @else { <span class="off">not set</span> }
                </td>
              </tr>
            }
          </tbody>

          <tfoot>
            <tr>
              <td>{{ rows().length }} {{ rows().length === 1 ? 'client' : 'clients' }}</td>
              <td></td>
              <td class="num">{{ totals().activeStudents | number }}</td>
              <td class="num">{{ totals().total | number }}</td>
              <td class="num">{{ totals().linked | number }}</td>
              <td class="num">{{ totals().unlinked | number }}</td>
              <td></td>
              <td>
                @if (missingAddresses(); as n) {
                  <span class="off">{{ n }} without an address</span>
                }
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; margin-top: 22px; overflow: hidden; box-shadow: var(--shadow); }
    .tscroll { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    th, td { padding: 11px 16px; text-align: left; white-space: nowrap; }
    thead th {
      color: var(--muted); font-weight: 600; font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em;
      border-bottom: 1px solid var(--grid); user-select: none;
    }
    thead th.sortable { cursor: pointer; }
    thead th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
    thead th .arrow { color: var(--linked); font-size: 10px; }
    tbody tr { border-bottom: 1px solid var(--grid); }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: color-mix(in srgb, var(--muted) 8%, transparent); }
    td.name { font-weight: 550; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
    /* An address is long and the row must not stretch for it — the full value is
       in the title attribute, and the drawer shows it in full. */
    td.addr { max-width: 260px; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); }
    tfoot td { font-weight: 650; border-top: 1px solid var(--grid); font-variant-numeric: tabular-nums; }
    tbody tr.rowlink { cursor: pointer; }
    tbody tr.rowlink:focus-visible { outline: 2px solid var(--linked); outline-offset: -2px; }
  `],
})
export class ClientTableComponent {
  rows = input.required<ClientRow[]>();
  sort = input.required<SortState>();

  sortBy = output<SortKey>();
  select = output<ClientRow>();

  protected readonly columns: Column[] = [
    { key: 'name', label: 'Client', numeric: false },
    { key: 'type', label: 'Type', numeric: false },
    // Before the pool numbers: it says how big the client is, which is what the
    // card counts beside it are read against.
    { key: 'activeStudents', label: 'Active students', numeric: true },
    { key: 'total', label: 'Total cards', numeric: true },
    { key: 'linked', label: 'Linked', numeric: true },
    { key: 'unlinked', label: 'Unlinked', numeric: true },
    { key: null, label: 'Split', numeric: false },
    { key: null, label: 'Ships to', numeric: false },
  ];

  /** Clients with nowhere to ship — the number that blocks a print run. */
  protected missingAddresses = computed(() => this.rows().filter((r) => !r.address).length);

  /** Footer totals reflect the rows actually shown, not the whole data set. */
  protected totals = computed(() =>
    this.rows().reduce(
      (a, r) => ({
        activeStudents: a.activeStudents + r.activeStudents,
        total: a.total + r.total,
        linked: a.linked + r.linked,
        unlinked: a.unlinked + r.unlinked,
      }),
      { activeStudents: 0, total: 0, linked: 0, unlinked: 0 },
    ),
  );
}
