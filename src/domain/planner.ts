import { createId } from '../lib/id';
import type {
  Actual,
  ActualDraft,
  DayNote,
  DayNoteDraft,
  Plan,
  PlanDraft,
} from '../types/domain';

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
    subject: draft.subject,
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
