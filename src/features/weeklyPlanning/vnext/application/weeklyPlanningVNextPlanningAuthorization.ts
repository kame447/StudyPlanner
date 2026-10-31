import { isWeeklyPlanningStableV5PreviewAuthorized } from '../weeklyPlanningVNextV5Boundary';
import type { WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';

type GateInput = Parameters<typeof isWeeklyPlanningStableV5PreviewAuthorized>[0];
export type VNextAuthorizationDecision = GateInput & {
  accepted: boolean;
  authorized: boolean;
  draftGenerationIntent: WeeklyPlanningVNextState['draftGenerationIntent'];
};

/** Mirrors V5's application ownership: the shared gate decides from validated intent and the
 * actual transaction diff, then its durable permission joins the one checkpoint. Complete facts,
 * question answers and renderer prose never grant it. PlanningAuthorization integration maps
 * V5's positive/negative/repair/draft-ready/timebox controls to this boundary.
 */
export function resolveVNextPlanningAuthorization(params: Omit<GateInput, 'previousDraftGenerationIntent'> & {
  state: WeeklyPlanningVNextState;
  accepted: boolean;
}): { authorized: boolean; state: WeeklyPlanningVNextState; decision: VNextAuthorizationDecision } {
  const input: GateInput = {
    previousStatus: params.previousStatus, previousDraftGenerationIntent: params.state.draftGenerationIntent,
    planningIntent: params.planningIntent, semanticChanged: params.semanticChanged,
    hadMachinePendingQuestion: params.hadMachinePendingQuestion, provisionalTimeboxRequested: params.provisionalTimeboxRequested,
  };
  const authorized = params.accepted && isWeeklyPlanningStableV5PreviewAuthorized(input);
  // V5 CompatibilityState keeps previously granted permission even on a non-creating turn.
  const draftGenerationIntent = !params.accepted ? params.state.draftGenerationIntent
    : authorized || params.state.draftGenerationIntent === 'user_authorized' ? 'user_authorized' : 'not_requested';
  return { authorized, state: draftGenerationIntent === params.state.draftGenerationIntent
    ? params.state : { ...params.state, draftGenerationIntent },
    decision: { ...input, accepted: params.accepted, authorized, draftGenerationIntent } };
}
