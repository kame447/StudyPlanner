import type { WeeklyPlanningDeclaredAmountWaitingMustConvey } from '../dialogue/weeklyPlanningMustConvey';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningFactGraphV5, WorkloadFactV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningQuestionContext } from '../intake/weeklyPlanningIntakeTypes';

/**
 * End state of a declared amount (Issue #488 P3 S1, (b′)). An amount whose role the application could not confirm (a stated
 * clock budget that answered a progress question becomes a `declared` fact) is confirmed ONCE: the role confirmation is
 * presented the first time and is then HELD (the question stays answerable in machine state, but no later turn re-presents it
 * and none falls back to another question that ignores the amount). The open item reaches the AI as a typed planning need; the
 * preview stays blocked. A role answer at any later turn still applies. Interaction only.
 */
export interface OpenRoleNeedV5 {
  need: 'role_unresolved';
  workloadFactId: string;
  amount: number;
  unitCode: 'minute' | 'hour';
  /** The user's own quote of the amount (a bounded, user-authored excerpt). */
  quote: string;
}

const QUOTE_LIMIT = 40;

export function openRoleNeedsV5(view: { workloads: ReadonlyArray<WorkloadFactV5> } | undefined): OpenRoleNeedV5[] {
  if (!view) return [];
  return view.workloads
    .filter((workload) => workload.quantityRole === 'declared' && (workload.unitCode === 'minute' || workload.unitCode === 'hour'))
    .map((workload) => ({
      need: 'role_unresolved' as const,
      workloadFactId: workload.id,
      amount: workload.amount,
      unitCode: workload.unitCode as 'minute' | 'hour',
      quote: workload.source.sourceText.replace(/\s+/g, ' ').trim().slice(0, QUOTE_LIMIT),
    }));
}

/** The next question is the role confirmation of the same declared amount that the previous turn already presented. */
export function isHeldRoleConfirmationV5(params: {
  previous: WeeklyPlanningQuestionContext | undefined;
  next: WeeklyPlanningQuestionContext | undefined;
  graph: WeeklyPlanningFactGraphV5 | undefined;
}): boolean {
  const { previous, next } = params;
  if (!previous || !next || next.targetSlot !== 'stable_v5:quantity_role_unresolved') return false;
  if (previous.targetSlot !== next.targetSlot || previous.topicId !== next.topicId || !next.topicId) return false;
  return openRoleNeedsV5(params.graph ? createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph) : undefined).some((need) => need.workloadFactId === next.topicId);
}

/** The verified-dialogue fact for a waiting declared amount (derived from application facts only, never from the AI's own declaration). */
export function mustConveyFromOpenRoleNeedV5(need: OpenRoleNeedV5): WeeklyPlanningDeclaredAmountWaitingMustConvey {
  return { code: 'declared_amount_waiting', factId: need.workloadFactId, quote: need.quote, amount: need.amount, unitCode: need.unitCode };
}
