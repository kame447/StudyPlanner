import { resolvePlanOccurrence } from '../lib/planRecurrence';
import { scheduleEventFromPlan } from './scheduleEvent';
import type { Actual, ActualProgressSource, MonthEvent, Plan } from '../types/domain';

export interface ActualProgressSources {
  plans: readonly Plan[];
  monthEvents: readonly MonthEvent[];
}

export interface PlanActualDetachment {
  beforeActuals: Actual[];
  afterActuals: Actual[];
}

// Keep the recorded work and its reporting provenance when its one-off plan is removed.
export function detachPlanActuals(actuals: readonly Actual[], plan: Plan): PlanActualDetachment {
  const beforeActuals = actuals.filter(actual => actual.userId === plan.userId && actual.planId === plan.id);
  return { beforeActuals, afterActuals: beforeActuals.map(actual => prepareActualProgressSource({
    ...actual, planId: null, title: actual.title?.trim() ? actual.title : plan.title, isAlignedToPlan: false,
  }, { plans: [plan], monthEvents: [] }, actual)) };
}

// Only persisted, same-owner schedule records establish provenance. Labels and
// ID prefixes never establish a source kind, and caller-supplied snapshots are
// not accepted by this write preparation boundary.
export function resolveLinkedActualProgressSource(
  actual: Pick<Actual, 'userId' | 'planId' | 'occurrenceDate'>,
  sources: ActualProgressSources,
): ActualProgressSource | undefined {
  if (!actual.planId) return undefined;
  const rawPlan = sources.plans.find(item => item.id === actual.planId && item.userId === actual.userId);
  const plan = rawPlan ? resolvePlanOccurrence(rawPlan, actual.occurrenceDate) : undefined;
  if (plan) return {
    kind: plan.sourceType === 'timetable' ? 'timetable' : scheduleEventFromPlan(plan).kind === 'study' ? 'study' : 'general-event',
    sourceId: plan.id,
    planType: plan.type,
  };
  const event = sources.monthEvents.find(item => item.id === actual.planId && item.userId === actual.userId);
  return event ? { kind: 'general-event', sourceId: event.id } : undefined;
}

export function prepareActualProgressSource(
  actual: Actual,
  sources: ActualProgressSources,
  previous?: Actual,
): Actual {
  const ownedPrevious = previous?.userId === actual.userId ? previous : undefined;
  const source = resolveLinkedActualProgressSource(actual, sources)
    ?? (ownedPrevious && (!actual.planId || actual.planId === ownedPrevious.planId)
      ? resolveLinkedActualProgressSource(ownedPrevious, sources) ?? ownedPrevious.progressSource
      : undefined);
  const { progressSource: _untrustedSource, ...rest } = actual;
  return source ? { ...rest, progressSource: { kind: source.kind, sourceId: source.sourceId, ...(source.planType ? { planType: source.planType } : {}) } } : rest;
}

export function preserveMonthEventActualSources(
  actuals: readonly Actual[],
  event: MonthEvent,
): Actual[] {
  return actuals.map(actual => actual.userId === event.userId && actual.planId === event.id
    ? { ...actual, progressSource: { kind: 'general-event', sourceId: event.id } }
    : actual);
}
