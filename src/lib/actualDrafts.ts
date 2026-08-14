import { getPlanOccurrenceDate } from './planRecurrence';
import type { Actual, ActualDraft, Plan } from '../types/domain';

export function resolveActualTitle(plan: Plan, actual?: Actual): string {
  return actual?.title?.trim() || plan.title;
}

export function resolveActualSubject(plan: Plan, actual?: Actual): string {
  return actual?.subject?.trim() || plan.subject;
}

export function resolveActualAlignedToPlan(plan: Plan, actual?: Actual): boolean {
  if (typeof actual?.isAlignedToPlan === 'boolean') {
    return actual.isAlignedToPlan;
  }

  return (
    resolveActualTitle(plan, actual) === plan.title &&
    resolveActualSubject(plan, actual) === plan.subject
  );
}

export function createActualDraftForPlan(plan: Plan, actual?: Actual): ActualDraft {
  return {
    userId: plan.userId,
    planId: plan.id,
    occurrenceDate: actual?.occurrenceDate ?? getPlanOccurrenceDate(plan),
    actualStartTime: actual?.actualStartTime ?? plan.startTime,
    actualEndTime: actual?.actualEndTime ?? plan.endTime,
    title: resolveActualTitle(plan, actual),
    subject: resolveActualSubject(plan, actual),
    isAlignedToPlan: resolveActualAlignedToPlan(plan, actual),
    note: actual?.note ?? '',
    materialId: actual?.materialId ?? plan.materialId ?? null,
    materialName: actual?.materialName ?? plan.materialName ?? '',
  };
}

export function createRelinkCandidateActual(
  actual: Actual,
  draft: ActualDraft,
): Actual {
  return {
    ...actual,
    occurrenceDate: draft.occurrenceDate,
    actualStartTime: draft.actualStartTime,
    actualEndTime: draft.actualEndTime,
    title: draft.title,
    subject: draft.subject,
    isAlignedToPlan: false,
    note: draft.note,
  };
}
