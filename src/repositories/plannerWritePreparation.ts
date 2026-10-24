import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
import type { Actual, MonthEvent } from '../types/domain';

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)]),
    ) as T;
  }

  return value;
}

export function prepareRecurringPlanWrite(
  mutation: RecurringPlanMutation,
  dependencies: {
    linkedActuals: readonly Actual[];
    duplicateOccurrenceActuals: readonly Actual[];
  },
): { actualDeletes: Actual[]; operationCount: number } {
  const reboundIds = new Set(mutation.actualUpserts.map((actual) => actual.id));
  const actualDeletesById = new Map(
    [
      ...mutation.actualDeletes,
      ...dependencies.duplicateOccurrenceActuals,
      ...dependencies.linkedActuals,
    ]
      .filter((actual) => !reboundIds.has(actual.id))
      .map((actual) => [actual.id, actual]),
  );
  const operationCount =
    mutation.planUpserts.length +
    mutation.planDeletes.length +
    mutation.actualUpserts.length +
    actualDeletesById.size;

  // Recurring mutations must remain atomic, so oversized writes cannot be split.
  if (operationCount > 500) {
    throw new Error('Recurring plan mutation exceeds the Firestore batch limit.');
  }

  return { actualDeletes: [...actualDeletesById.values()], operationCount };
}

// Scope edits replace a source series and optionally create one replacement.
// Keep this boundary bounded so no adapter can split the operation.
export function assertRecurringMonthEventWrite(
  userId: string,
  monthEvents: readonly MonthEvent[],
): void {
  if (monthEvents.length < 1 || monthEvents.length > 2) {
    throw new Error('繰り返し予定更新は1〜2件の予定が必要です。');
  }
  if (monthEvents.some((event) => event.userId !== userId)) {
    throw new Error('繰り返し予定更新 の所有者が一致しません。');
  }
  if (new Set(monthEvents.map((event) => event.id)).size !== monthEvents.length) {
    throw new Error('繰り返し予定更新のIDが重複しています。');
  }
}
