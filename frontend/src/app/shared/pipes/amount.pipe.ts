import { Pipe, PipeTransform } from '@angular/core';

// Number formatter — always en-US digits (1,234.56) regardless of UI language.
@Pipe({ name: 'amount', standalone: true })
export class AmountPipe implements PipeTransform {
  transform(value: number | string | null | undefined, decimals: number = 2): string {
    if (value === null || value === undefined || value === '') return '';
    const n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return '';
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  }
}
