import {
  CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
} from './weeklyPlanningCalendarResolver';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

const CANONICAL_WEEKDAYS = new Set<string>(CANONICAL_WEEKDAY_DATE_EXPRESSIONS);
const BARE_WEEKDAY_TO_CANONICAL = new Map<string, string>(
  CANONICAL_WEEKDAY_DATE_EXPRESSIONS.map((value) => [
    value.replace(/^weekday:/, ''),
    value,
  ]),
);

export interface WeekdayEncodingNormalizationV5 {
  document: WeeklyPlanningSemanticDocumentV5;
  repairs: string[];
}

function normalizeDays(
  days: readonly string[],
  owner: string,
): { days: string[]; repairs: string[] } {
  const repairs: string[] = [];
  const normalized = days.map((day) => {
    if (CANONICAL_WEEKDAYS.has(day)) return day;
    const canonical = BARE_WEEKDAY_TO_CANONICAL.get(day);
    if (!canonical) return day;
    repairs.push(`weekday-token-canonicalized:${owner}:${day}->${canonical}`);
    return canonical;
  });
  return { days: normalized, repairs };
}

export function normalizeWeeklyPlanningWeekdayEncodingV5(
  document: WeeklyPlanningSemanticDocumentV5,
): WeekdayEncodingNormalizationV5 {
  const repairs: string[] = [];
  const tasks = document.tasks.map((task) => {
    const recurrence = task.recurrence.map((item) => {
      const normalized = normalizeDays(item.days, `recurrence:${item.localId}`);
      repairs.push(...normalized.repairs);
      return normalized.repairs.length > 0 ? { ...item, days: normalized.days } : item;
    });
    return recurrence.some((item, index) => item !== task.recurrence[index])
      ? { ...task, recurrence }
      : task;
  });
  const availabilityDeclarations = document.availabilityDeclarations.map((item) => {
    const normalized = normalizeDays(item.days, `availability:${item.localId}`);
    repairs.push(...normalized.repairs);
    return normalized.repairs.length > 0 ? { ...item, days: normalized.days } : item;
  });

  if (repairs.length === 0) return { document, repairs: [] };
  return {
    document: {
      ...document,
      tasks,
      availabilityDeclarations,
    },
    repairs,
  };
}

function dayErrors(params: {
  ownerPath: string;
  localId: string;
  days: readonly string[];
}): string[] {
  return params.days.flatMap((day) =>
    CANONICAL_WEEKDAYS.has(day)
      ? []
      : [`${params.ownerPath}[${params.localId}].days:canonical-weekday-required:${day}`]);
}

export function validateWeeklyPlanningWeekdayEncodingV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  return [
    ...document.availabilityDeclarations.flatMap((declaration) => dayErrors({
      ownerPath: 'availabilityDeclarations',
      localId: declaration.localId,
      days: declaration.days,
    })),
    ...document.tasks.flatMap((task) =>
      task.recurrence.flatMap((recurrence) => dayErrors({
        ownerPath: 'recurrence',
        localId: recurrence.localId,
        days: recurrence.days,
      }))),
  ];
}
