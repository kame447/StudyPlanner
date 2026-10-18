import { PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE } from './productObservabilityReadModel';

/** A reporting date is independent of the browser or Worker's local timezone. */
export function formatObservabilityReportingDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

/** Shift date labels in UTC calendar days, never elapsed local/DST days.
 * Callers retain ownership of input validation and their public error contract.
 */
export function shiftObservabilityDate(localDate: string, offset: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(new Date(`${value}T00:00:00.000Z`).getTime());
}

export function listObservabilityDatesInclusive(
  fromDate: string,
  toDate: string,
  maxDays: number,
): string[] {
  if (
    !isIsoDate(fromDate)
    || !isIsoDate(toDate)
    || fromDate > toDate
    || !Number.isSafeInteger(maxDays)
    || maxDays < 1
  ) {
    throw new Error('observability_date_range_invalid');
  }
  // Preserve the readers' existing Date normalization as well as UTC day boundaries.
  const start = new Date(`${fromDate}T00:00:00.000Z`);
  const end = new Date(`${toDate}T00:00:00.000Z`);
  const result: string[] = [];
  for (let current = start.getTime(); current <= end.getTime(); current += 86_400_000) {
    result.push(new Date(current).toISOString().slice(0, 10));
    if (result.length > maxDays) {
      throw new Error('observability_date_range_too_large');
    }
  }
  return result;
}
