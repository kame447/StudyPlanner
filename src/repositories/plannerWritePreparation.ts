import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
import type { Actual } from '../types/domain';

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
