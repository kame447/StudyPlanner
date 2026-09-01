import { resolvePlanOccurrence } from '../lib/planRecurrence';
import type { MonthEvent, Plan } from '../types/domain';
import type { ScheduleOccurrence } from './scheduleOccurrence';

export interface DeleteScheduleOccurrenceParams {
  occurrence: ScheduleOccurrence;
  plans: readonly Plan[];
  monthEvents: readonly MonthEvent[];
  deletePlan: (plan: Plan) => Promise<void>;
  deleteMonthEvent: (monthEvent: MonthEvent) => Promise<void>;
  confirmRecurringMonthEventSeries: (monthEvent: MonthEvent) => boolean | Promise<boolean>;
}

export type DeleteScheduleOccurrenceResult =
  | { status: 'deleted'; backingKind: 'plan' | 'month-event' }
  | { status: 'canceled'; backingKind: 'month-event' };

function resolvePlanDeleteTarget(
  occurrence: ScheduleOccurrence,
  plans: readonly Plan[],
): Plan {
  const sourcePlan = plans.find(
    (plan) => plan.id === occurrence.source.backingId && plan.userId === occurrence.ownerId,
  );

  if (!sourcePlan) {
    throw new Error('削除対象の予定を確認できませんでした。');
  }

  return resolvePlanOccurrence(sourcePlan, occurrence.start.date);
}

function resolveMonthEventDeleteTarget(
  occurrence: ScheduleOccurrence,
  monthEvents: readonly MonthEvent[],
): MonthEvent {
  const monthEvent = monthEvents.find(
    (event) =>
      event.id === occurrence.source.backingId && event.userId === occurrence.ownerId,
  );

  if (!monthEvent) {
    throw new Error('削除対象の主要予定を確認できませんでした。');
  }

  return monthEvent;
}

export async function deleteScheduleOccurrence(
  params: DeleteScheduleOccurrenceParams,
): Promise<DeleteScheduleOccurrenceResult> {
  const { occurrence } = params;

  if (occurrence.source.backingKind === 'plan') {
    const plan = resolvePlanDeleteTarget(occurrence, params.plans);
    await params.deletePlan(plan);
    return { status: 'deleted', backingKind: 'plan' };
  }

  if (occurrence.source.backingKind === 'month-event') {
    const monthEvent = resolveMonthEventDeleteTarget(occurrence, params.monthEvents);
    if (monthEvent.repeat !== 'none') {
      const confirmed = await params.confirmRecurringMonthEventSeries(monthEvent);
      if (!confirmed) {
        return { status: 'canceled', backingKind: 'month-event' };
      }
    }

    await params.deleteMonthEvent(monthEvent);
    return { status: 'deleted', backingKind: 'month-event' };
  }

  throw new Error('時間割テンプレート由来の予定はこの画面から削除できません。');
}
