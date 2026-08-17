import { TranslateService } from '@ngx-translate/core';
import { SessionDueItem } from '../../../features/rooms/services/attendance.service';

/**
 * "June 2026" for a monthly item; the server's own label for anything else.
 * The month name is built here rather than server-side so it reads in the UI's
 * language, not the Lambda's.
 */
export function dueItemLabel(item: SessionDueItem, translate: TranslateService): string {
  // An unpaid bundle: say how many lessons have been sat against it, because that
  // is what the desk is being asked about — "he came 3 times and paid nothing".
  if (item.kind === 'PACKAGE') {
    return translate.instant('SESSION_ATTENDANCE.DUE_BUNDLE', {
      used: item.sessionsUsed ?? 0,
      total: item.sessionsTotal ?? 0,
    });
  }
  if (item.kind !== 'MONTHLY' || !item.billingMonth) return item.label;
  const month = translate.instant('MONTHLY_SUBSCRIPTIONS.MONTHS.' + item.billingMonth);
  return `${month} ${item.billingYear}`;
}
