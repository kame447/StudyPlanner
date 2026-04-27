import { addDays } from '../lib/date';
import { createId } from '../lib/id';
import {
  buildRecurrenceRulesFromLegacySource,
  doesPlanOccurOnDate,
  getFirstRecurrenceOccurrenceDate,
  normalizeRecurrenceRule,
} from '../lib/planRecurrence';
import { createPlanFromDraft } from './planner';
import type {
  Plan,
  PlanDraft,
  RecurrenceRule,
  RecurringPlanScope,
} from '../types/domain';

export interface ScopedPlanEditResult {
  updatedPlan: Plan | null;
  createdPlan: Plan | null;
}

function cloneRule(rule: RecurrenceRule): RecurrenceRule {
  return {
    ...rule,
    dates: [...rule.dates],
    weekdays: [...rule.weekdays],
  };
}

function createStoredPlanDraft(plan: Plan): PlanDraft {
  return {
    userId: plan.userId,
    title: plan.title,
    subject: plan.subject,
    date: plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
    repeat: plan.repeat,
    repeatUntil: plan.repeatUntil,
    excludedDates: [...plan.excludedDates],
    recurrenceRules: resolveWorkingRules(plan).map(cloneRule),
    type: plan.type,
    memo: plan.memo,
  };
}

function resolveWorkingRules(plan: Plan): RecurrenceRule[] {
  if (plan.recurrenceRules.length > 0) {
    return plan.recurrenceRules.map(cloneRule);
  }

  return buildRecurrenceRulesFromLegacySource(plan).map(cloneRule);
}

function trimOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function applyDraftToRule(rule: RecurrenceRule, draft: PlanDraft): RecurrenceRule {
  return {
    ...cloneRule(rule),
    startTime: draft.startTime,
    endTime: draft.endTime,
    title: trimOptionalText(draft.title),
    subject: trimOptionalText(draft.subject),
    type: draft.type,
    memo: trimOptionalText(draft.memo),
  };
}

function getSeriesFirstDate(plan: Plan): string {
  const candidates = [plan.date];

  resolveWorkingRules(plan).forEach((rule) => {
    candidates.push(rule.startDate);
    rule.dates.forEach((date) => candidates.push(date));
  });

  return [...new Set(candidates)].sort((left, right) => left.localeCompare(right))[0] ?? plan.date;
}

function removeOccurrenceFromDateRules(
  rules: RecurrenceRule[],
  occurrenceDate: string,
): RecurrenceRule[] {
  return rules.flatMap((rule) => {
    if (rule.kind !== 'date') {
      return [cloneRule(rule)];
    }

    const nextDates = rule.dates.filter((date) => date !== occurrenceDate);

    if (nextDates.length === 0) {
      return [];
    }

    return [
      normalizeRecurrenceRule(
        {
          ...rule,
          dates: nextDates,
          startDate: nextDates[0] ?? rule.startDate,
        },
        0,
        {},
      ),
    ];
  });
}

function truncateRulesBeforeDate(
  rules: RecurrenceRule[],
  occurrenceDate: string,
  previousOccurrenceDate: string | null,
): RecurrenceRule[] {
  return rules.flatMap((rule) => {
    if (rule.kind === 'date') {
      const nextDates = rule.dates.filter((date) => date.localeCompare(occurrenceDate) < 0);

      if (nextDates.length === 0) {
        return [];
      }

      return [
        normalizeRecurrenceRule(
          {
            ...rule,
            dates: nextDates,
            startDate: nextDates[0] ?? rule.startDate,
          },
          0,
          {},
        ),
      ];
    }

    if (!previousOccurrenceDate || rule.startDate.localeCompare(occurrenceDate) >= 0) {
      return [];
    }

    const nextUntil =
      rule.until && rule.until.localeCompare(previousOccurrenceDate) < 0
        ? rule.until
        : previousOccurrenceDate;

    if (nextUntil.localeCompare(rule.startDate) < 0) {
      return [];
    }

    return [
      normalizeRecurrenceRule(
        {
          ...rule,
          until: nextUntil,
        },
        0,
        {},
      ),
    ];
  });
}

function retainRulesFromDate(
  rules: RecurrenceRule[],
  occurrenceDate: string,
): RecurrenceRule[] {
  return rules.flatMap((rule) => {
    if (rule.kind === 'date') {
      const nextDates = rule.dates.filter((date) => date.localeCompare(occurrenceDate) >= 0);

      if (nextDates.length === 0) {
        return [];
      }

      return [
        normalizeRecurrenceRule(
          {
            ...rule,
            dates: nextDates,
            startDate: nextDates[0] ?? occurrenceDate,
          },
          0,
          {},
        ),
      ];
    }

    if (rule.until && rule.until.localeCompare(occurrenceDate) < 0) {
      return [];
    }

    return [
      normalizeRecurrenceRule(
        {
          ...rule,
          startDate:
            rule.startDate.localeCompare(occurrenceDate) >= 0
              ? rule.startDate
              : occurrenceDate,
        },
        0,
        {},
      ),
    ];
  });
}

function buildSingleOccurrenceOverrideRule(
  plan: Plan,
  draft: PlanDraft,
  occurrenceDate: string,
): RecurrenceRule {
  return normalizeRecurrenceRule(
    {
      id: `override-${occurrenceDate}-${createId('rule')}`,
      kind: 'date',
      startDate: occurrenceDate,
      until: occurrenceDate,
      dates: [occurrenceDate],
      weekdays: [],
      dayType: null,
      startTime: draft.startTime,
      endTime: draft.endTime,
      title: trimOptionalText(draft.title) ?? plan.title,
      subject: trimOptionalText(draft.subject) ?? plan.subject,
      type: draft.type,
      memo: trimOptionalText(draft.memo),
      isOverride: true,
    },
    0,
    {
      date: occurrenceDate,
      startTime: draft.startTime,
      endTime: draft.endTime,
      title: draft.title,
      subject: draft.subject,
      type: draft.type,
      memo: draft.memo,
    },
  );
}

function finalizePlan(
  currentPlan: Plan,
  draft: PlanDraft,
  overrides: Partial<PlanDraft>,
  forcedId?: string,
): Plan {
  const nextDraft: PlanDraft = {
    ...draft,
    ...overrides,
  };
  const basePlan =
    forcedId && forcedId !== currentPlan.id
      ? {
          ...currentPlan,
          id: forcedId,
        }
      : currentPlan;
  const nextPlan = createPlanFromDraft(nextDraft, basePlan);

  return {
    ...nextPlan,
    id: forcedId ?? nextPlan.id,
    seriesId: currentPlan.seriesId || currentPlan.id,
  };
}

export function supportsScopedRecurringPlanEdits(plan: Plan): boolean {
  const rules = resolveWorkingRules(plan);
  return (
    rules.length > 0 &&
    rules.every((rule) =>
      rule.kind === 'daily' ||
      rule.kind === 'monthly' ||
      rule.kind === 'day-type' ||
      rule.kind === 'weekday' ||
      rule.kind === 'date',
    )
  );
}

export function getPreviousPlanOccurrenceDate(
  plan: Plan,
  occurrenceDate: string,
): string | null {
  const earliestDate = getSeriesFirstDate(plan);
  let cursor = addDays(occurrenceDate, -1);

  while (cursor.localeCompare(earliestDate) >= 0) {
    if (doesPlanOccurOnDate(plan, cursor)) {
      return cursor;
    }

    cursor = addDays(cursor, -1);
  }

  return null;
}

export function applyRecurringPlanEditScope(
  plan: Plan,
  occurrenceDate: string,
  draft: PlanDraft,
  scope: Exclude<RecurringPlanScope, 'all'>,
): ScopedPlanEditResult {
  const baseDraft = createStoredPlanDraft(plan);
  const baseRules = resolveWorkingRules(plan);

  if (scope === 'single') {
    const nextRules = removeOccurrenceFromDateRules(baseRules, occurrenceDate).concat(
      buildSingleOccurrenceOverrideRule(plan, draft, occurrenceDate),
    );

    return {
      updatedPlan: finalizePlan(plan, baseDraft, {
        recurrenceRules: nextRules,
      }),
      createdPlan: null,
    };
  }

  const previousOccurrenceDate = getPreviousPlanOccurrenceDate(plan, occurrenceDate);
  const currentRules = truncateRulesBeforeDate(
    baseRules,
    occurrenceDate,
    previousOccurrenceDate,
  );
  const futureRules = retainRulesFromDate(baseRules, occurrenceDate).map((rule) =>
    applyDraftToRule(rule, draft),
  );
  const nextCurrentPlan =
    currentRules.length > 0
      ? finalizePlan(plan, baseDraft, {
          recurrenceRules: currentRules,
          excludedDates: baseDraft.excludedDates.filter(
            (date) => date.localeCompare(occurrenceDate) < 0,
          ),
          date: getFirstRecurrenceOccurrenceDate(
            currentRules,
            plan.date,
            plan.date,
          ),
        })
      : null;
  const futurePlanId = createId('plan');
  const nextFuturePlan = finalizePlan(
    plan,
    {
      ...baseDraft,
      title: draft.title,
      subject: draft.subject,
      date: occurrenceDate,
      startTime: draft.startTime,
      endTime: draft.endTime,
      repeatUntil: draft.repeatUntil,
      recurrenceRules: futureRules,
      excludedDates: baseDraft.excludedDates.filter(
        (date) => date.localeCompare(occurrenceDate) >= 0,
      ),
      type: draft.type,
      memo: draft.memo,
    },
    {
      date: getFirstRecurrenceOccurrenceDate(
        futureRules,
        occurrenceDate,
        occurrenceDate,
      ),
      recurrenceRules: futureRules,
      excludedDates: baseDraft.excludedDates.filter(
        (date) => date.localeCompare(occurrenceDate) >= 0,
      ),
    },
    futurePlanId,
  );

  return {
    updatedPlan: nextCurrentPlan,
    createdPlan: nextFuturePlan,
  };
}

export function applyRecurringPlanDeleteScope(
  plan: Plan,
  occurrenceDate: string,
  scope: Exclude<RecurringPlanScope, 'all'>,
): Plan | null {
  const baseDraft = createStoredPlanDraft(plan);
  const baseRules = resolveWorkingRules(plan);

  if (scope === 'single') {
    return finalizePlan(plan, baseDraft, {
      recurrenceRules: removeOccurrenceFromDateRules(baseRules, occurrenceDate),
      excludedDates: [...new Set([...baseDraft.excludedDates, occurrenceDate])].sort((left, right) =>
        left.localeCompare(right),
      ),
    });
  }

  const previousOccurrenceDate = getPreviousPlanOccurrenceDate(plan, occurrenceDate);
  const nextRules = truncateRulesBeforeDate(baseRules, occurrenceDate, previousOccurrenceDate);

  if (nextRules.length === 0) {
    return null;
  }

  return finalizePlan(plan, baseDraft, {
    recurrenceRules: nextRules,
    excludedDates: baseDraft.excludedDates.filter(
      (date) => date.localeCompare(occurrenceDate) < 0,
    ),
    date: getFirstRecurrenceOccurrenceDate(nextRules, plan.date, plan.date),
  });
}

export function applyRecurringPlanSeriesEdit(plan: Plan, draft: PlanDraft): Plan {
  const baseDraft = createStoredPlanDraft(plan);
  const nextRules = resolveWorkingRules(plan).map((rule) => applyDraftToRule(rule, draft));

  return finalizePlan(plan, baseDraft, {
    title: draft.title,
    subject: draft.subject,
    startTime: draft.startTime,
    endTime: draft.endTime,
    type: draft.type,
    memo: draft.memo,
    recurrenceRules: nextRules,
  });
}
