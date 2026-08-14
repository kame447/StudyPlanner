import {
  CANONICAL_RELATIVE_DATE_EXPRESSIONS,
  type CanonicalRelativeDateExpression,
  isValidCalendarDate,
} from '../semantic/weeklyPlanningCalendarResolver';

const CANONICAL_DATE_LABELS: Partial<Record<CanonicalRelativeDateExpression, string>> = {
  today: '今日',
  tomorrow: '明日',
  day_after_tomorrow: '明後日',
  this_week: '今週',
  next_week: '来週',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayField(
  value: Record<string, unknown> | null,
  key: string,
): unknown[] {
  const field = value?.[key];
  return Array.isArray(field) ? field : [];
}

function canonicalRelativeDateLabel(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || !(CANONICAL_RELATIVE_DATE_EXPRESSIONS as readonly string[]).includes(value)
  ) {
    return null;
  }
  return CANONICAL_DATE_LABELS[value as CanonicalRelativeDateExpression] ?? null;
}

function localizedAbsoluteDate(value: unknown): string | null {
  if (typeof value !== 'string' || !isValidCalendarDate(value)) return null;
  const [, month, day] = value.split('-').map(Number);
  return `${month}月${day}日`;
}

function addDateValue(target: Set<string>, value: unknown): void {
  const relative = canonicalRelativeDateLabel(value);
  if (relative) target.add(relative);
  const absolute = localizedAbsoluteDate(value);
  if (absolute) target.add(absolute);
}

function addKnownDateFields(
  target: Set<string>,
  entries: readonly unknown[],
  keys: readonly string[],
): void {
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    for (const key of keys) addDateValue(target, entry[key]);
  }
}

export function groundedDateExpressionsFromPlanningInformation(
  planningInformation: Record<string, unknown> | null,
): string[] {
  const grounded = new Set<string>();

  addKnownDateFields(
    grounded,
    arrayField(planningInformation, 'planningWindows'),
    ['value', 'start', 'end'],
  );
  addKnownDateFields(
    grounded,
    arrayField(planningInformation, 'groundingRecords'),
    ['startDate', 'endDate'],
  );
  addKnownDateFields(
    grounded,
    arrayField(planningInformation, 'temporalConstraints'),
    ['dateExpression'],
  );
  addKnownDateFields(
    grounded,
    arrayField(planningInformation, 'taskDateRules'),
    ['dateExpression'],
  );
  addKnownDateFields(
    grounded,
    arrayField(planningInformation, 'availabilityDeclarations'),
    ['dateExpression'],
  );

  return [...grounded];
}
