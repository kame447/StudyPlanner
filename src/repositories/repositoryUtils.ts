import type { Actual, MonthEventRepeat, Plan } from '../types/domain';
import {
  normalizeRecurrenceRules,
  summarizeLegacyRepeatFromRecurrenceRules,
  summarizeLegacyRepeatUntilFromRecurrenceRules,
} from '../lib/planRecurrence';

export function replaceById<T extends { id: string }>(
  records: T[],
  nextRecord: T,
): T[] {
  return records.some((record) => record.id === nextRecord.id)
    ? records.map((record) => (record.id === nextRecord.id ? nextRecord : record))
    : [...records, nextRecord];
}

export function filterByUserId<T extends { userId: string }>(
  records: T[],
  userId: string,
): T[] {
  return records.filter((record) => record.userId === userId);
}

function normalizeRepeat(value: unknown): MonthEventRepeat {
  return value === 'daily' ||
    value === 'weekly' ||
    value === 'monthly' ||
    value === 'yearly'
    ? value
    : 'none';
}

export function normalizePlanRecord(plan: Plan): Plan {
  const recurrenceRules = normalizeRecurrenceRules(plan.recurrenceRules, {
    date: plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
    title: plan.title,
    subject: plan.subject,
    type: plan.type,
    memo: plan.memo,
    repeatUntil: plan.repeatUntil,
  });
  const repeat =
    summarizeLegacyRepeatFromRecurrenceRules(recurrenceRules) ??
    normalizeRepeat(plan.repeat);

  return {
    ...plan,
    repeat,
    repeatUntil:
      recurrenceRules.length > 0
        ? summarizeLegacyRepeatUntilFromRecurrenceRules(
            recurrenceRules,
            plan.repeatUntil ?? null,
          )
        : plan.repeatUntil ?? null,
    excludedDates: Array.isArray(plan.excludedDates)
      ? plan.excludedDates.filter((date): date is string => typeof date === 'string' && date.length > 0)
      : [],
    recurrenceRules,
  };
}

export function normalizeActualRecord(
  actual: Actual & {
    date?: string;
  },
): Actual {
  return {
    ...actual,
    occurrenceDate: actual.occurrenceDate ?? actual.date ?? '',
  };
}
