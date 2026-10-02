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
