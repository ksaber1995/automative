import { Injectable } from '@angular/core';

// Sibling of AmountPipe for use in .ts files (toast messages, chart labels,
// etc.). Always en-US digits regardless of UI language.
@Injectable({ providedIn: 'root' })
export class NumberFormatService {
  format(value: number | string | null | undefined, decimals: number = 2): string {
    if (value === null || value === undefined || value === '') return '';
    const n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return '';
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  }
}
