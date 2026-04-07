import { createId } from '../lib/id';
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

export function createEmptyPlanDraft(userId: string, date: string): PlanDraft {
  return {
    userId,
    title: '',
    subject: '',
    date,
    startTime: '19:00',
    endTime: '20:00',
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
  return {
    userId: plan.userId,
    title: plan.title,
    subject: plan.subject,
    date: plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
    type: plan.type,
    memo: plan.memo,
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

  if (currentPlan) {
    return {
      ...currentPlan,
      ...draft,
      updatedAt: now,
    };
  }

  return {
    id: createId('plan'),
    ...draft,
    createdAt: now,
    updatedAt: now,
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
    actualStartTime: draft.actualStartTime,
    actualEndTime: draft.actualEndTime,
    title: draft.title,
    subject: draft.subject,
    isAlignedToPlan: draft.isAlignedToPlan,
    note: draft.note,
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
