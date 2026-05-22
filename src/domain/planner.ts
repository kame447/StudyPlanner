import { createId } from '../lib/id';
import {
  buildRecurrenceRulesFromLegacySource,
  normalizeRecurrenceRules,
  summarizeLegacyRepeatFromRecurrenceRules,
  summarizeLegacyRepeatUntilFromRecurrenceRules,
} from '../lib/planRecurrence';
import type {
  Actual,
  ActualDraft,
  DayNote,
  DayNoteDraft,
  MonthEvent,
  MonthEventChecklistItem,
  MonthEventDraft,
  Plan,
  PlanDraft,
} from '../types/domain';

function normalizeMonthEventExcludedDates(
  date: string,
  excludedDates: string[],
): string[] {
  return [...new Set(excludedDates)]
    .filter((excludedDate) => excludedDate.localeCompare(date) >= 0)
    .sort((left, right) => left.localeCompare(right));
}

function normalizePlanExcludedDates(
  date: string,
  excludedDates: string[],
): string[] {
  return [...new Set(excludedDates)]
    .filter((excludedDate) => excludedDate.localeCompare(date) >= 0)
    .sort((left, right) => left.localeCompare(right));
}

export function createEmptyPlanDraft(userId: string, date: string): PlanDraft {
  return {
    userId,
    title: '',
    subject: '',
    date,
    startTime: '19:00',
    endTime: '20:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
  };
}

export function createEmptyMonthEventDraft(
  userId: string,
  date: string,
): MonthEventDraft {
  return {
    userId,
    date,
    title: '',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    url: '',
    memo: '',
    checklist: [],
    locationTags: [],
  };
}

export function createEmptyMonthEventChecklistItem(): MonthEventChecklistItem {
  return {
    id: createId('month-event-item'),
    text: '',
    checked: false,
  };
}

export function createMonthEventDraftFromEvent(event: MonthEvent): MonthEventDraft {
  return {
    userId: event.userId,
    date: event.date,
    title: event.title,
    startTime: event.startTime,
    endTime: event.endTime,
    repeat: event.repeat,
    repeatUntil: event.repeatUntil,
    excludedDates: [...event.excludedDates],
    url: event.url,
    memo: event.memo,
    checklist: event.checklist.map((item) => ({ ...item })),
    locationTags: [...event.locationTags],
  };
}

export function createPlanDraftFromPlan(plan: Plan): PlanDraft {
  const recurrenceRules =
    plan.recurrenceRules.length > 0
      ? plan.recurrenceRules.map((rule) => ({
          ...rule,
          dates: [...rule.dates],
          weekdays: [...rule.weekdays],
        }))
      : buildRecurrenceRulesFromLegacySource(plan);

  return {
    userId: plan.userId,
    title: plan.title,
    subject: plan.subject,
    date: plan.occurrenceDate ?? plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
    repeat: plan.repeat,
    repeatUntil: plan.repeatUntil,
    excludedDates: [...plan.excludedDates],
    recurrenceRules,
    type: plan.type,
    memo: plan.memo,
    materialId: plan.materialId ?? null,
    materialName: plan.materialName ?? '',
  };
}

export function createEmptyDayNoteDraft(userId: string, date: string): DayNoteDraft {
  return {
    userId,
    date,
    quickMemo: '',
    reflection: '',
    nextFocus: '',
    checkedPlan: false,
    checkedRecord: false,
    checkedReady: false,
  };
}

export function resolveDayNoteDraft(
  dayNotes: DayNote[],
  userId: string,
  date: string,
): DayNote | DayNoteDraft {
  return (
    dayNotes.find((dayNote) => dayNote.date === date) ??
    createEmptyDayNoteDraft(userId, date)
  );
}

export function createPlanFromDraft(draft: PlanDraft, currentPlan?: Plan): Plan {
  const now = new Date().toISOString();
  const nextPlanId = currentPlan?.id ?? createId('plan');
  const draftRecurrenceRules = Array.isArray(draft.recurrenceRules)
    ? draft.recurrenceRules
    : [];
  const recurrenceRules = normalizeRecurrenceRules(
    draftRecurrenceRules.length > 0
      ? draftRecurrenceRules
      : buildRecurrenceRulesFromLegacySource({
          date: draft.date,
          startTime: draft.startTime,
          endTime: draft.endTime,
          repeat: draft.repeat,
          repeatUntil: draft.repeatUntil,
          title: draft.title,
          subject: draft.subject,
          type: draft.type,
          memo: draft.memo,
        }),
    {
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
      title: draft.title,
      subject: draft.subject,
      type: draft.type,
      memo: draft.memo,
      repeatUntil: draft.repeatUntil,
    },
  );
  const repeat =
    summarizeLegacyRepeatFromRecurrenceRules(recurrenceRules) ?? draft.repeat;
  const repeatUntil =
    recurrenceRules.length > 0
      ? summarizeLegacyRepeatUntilFromRecurrenceRules(recurrenceRules, draft.repeatUntil)
      : draft.repeat === 'none' || !draft.repeatUntil
        ? null
        : draft.repeatUntil;
  const excludedDates =
    repeat === 'none' && recurrenceRules.length === 0
      ? []
      : normalizePlanExcludedDates(draft.date, draft.excludedDates);

  if (currentPlan) {
    return {
      ...currentPlan,
      ...draft,
      id: nextPlanId,
      seriesId: currentPlan.seriesId || currentPlan.id,
      repeat,
      repeatUntil,
      excludedDates,
      recurrenceRules,
      updatedAt: now,
      materialId: draft.materialId ?? null,
      materialName: draft.materialName?.trim() ?? '',
    };
  }

  return {
    id: nextPlanId,
    seriesId: nextPlanId,
    ...draft,
    repeat,
    repeatUntil,
    excludedDates,
    recurrenceRules,
    createdAt: now,
    updatedAt: now,
    materialId: draft.materialId ?? null,
    materialName: draft.materialName?.trim() ?? '',
  };
}

export function createActualFromDraft(
  userId: string,
  draft: ActualDraft,
  existingActual?: Actual,
): Actual {
  return {
    id: existingActual?.id ?? createId('actual'),
    userId,
    planId: draft.planId,
    occurrenceDate: draft.occurrenceDate,
    actualStartTime: draft.actualStartTime,
    actualEndTime: draft.actualEndTime,
    title: draft.title,
    subject: draft.subject,
    isAlignedToPlan: draft.isAlignedToPlan,
    note: draft.note,
    materialId: draft.materialId ?? null,
    materialName: draft.materialName?.trim() ?? '',
    materialProgressUpdates: draft.materialProgressUpdates,
    updatedAt: new Date().toISOString(),
  };
}

export function createDayNoteFromDraft(
  draft: DayNoteDraft,
  currentDayNote?: DayNote,
): DayNote {
  return {
    id: currentDayNote?.id ?? createId('day-note'),
    ...draft,
    updatedAt: new Date().toISOString(),
  };
}

export function createMonthEventFromDraft(
  draft: MonthEventDraft,
  currentEvent?: MonthEvent,
): MonthEvent {
  const now = new Date().toISOString();
  const repeatUntil =
    draft.repeat === 'none' || !draft.repeatUntil ? null : draft.repeatUntil;
  const excludedDates =
    draft.repeat === 'none'
      ? []
      : normalizeMonthEventExcludedDates(draft.date, draft.excludedDates);

  if (currentEvent) {
    return {
      ...currentEvent,
      ...draft,
      repeatUntil,
      excludedDates,
      checklist: draft.checklist.map((item) => ({ ...item })),
      locationTags: [...draft.locationTags],
      updatedAt: now,
    };
  }

  return {
    id: createId('month-event'),
    ...draft,
    repeatUntil,
    excludedDates,
    checklist: draft.checklist.map((item) => ({ ...item })),
    locationTags: [...draft.locationTags],
    createdAt: now,
    updatedAt: now,
  };
}
