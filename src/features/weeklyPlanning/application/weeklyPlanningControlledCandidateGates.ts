import type { CandidateBinding } from './candidateSelection/contracts';
import type { PlanningState, WeeklyPlanningPendingTurn } from '../types';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import { serializeC5Value, serializeC5ApplicationState } from './c5LocalSelection/basis';

export interface ControlledCandidateGateInput {
  snapshot: PlanningState; pending: WeeklyPlanningPendingTurn; userText: string;
  getState(): PlanningState;
}
/** Domain-independent checks against the actual begin transition and bound presentation.
 * Semantic scope, active target and lease are independently supplied by the domain/host. */
export function controlledCandidateTurnGates(input: ControlledCandidateGateInput, graph: WeeklyPlanningFactGraphV5,
  frozen: { question: CandidateBinding['question']; target: CandidateBinding['target'] } | null,
  current: PlanningState = input.getState()) {
  const original = input.snapshot.intakeState;
  const p = current.pendingTurn;
  const beginMatches = current.revision === input.pending.baseRevision + 1
    && current.weekStartDate === input.pending.weekStartDate
    && p?.requestId === input.pending.requestId && p.turnId === input.pending.turnId
    && p.conversationId === input.pending.conversationId && p.baseRevision === input.pending.baseRevision
    && current.messages.length === input.snapshot.messages.length + 1
    && serializeC5Value(current.messages.slice(0, -1)) === serializeC5Value(input.snapshot.messages)
    && current.messages[current.messages.length - 1]?.id === `${input.pending.turnId}:user`
    && current.messages[current.messages.length - 1]?.content === input.userText
    && serializeC5ApplicationState(current.intakeState ?? null) === serializeC5ApplicationState(original ?? null);
  const freshness = resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: original, inputStateRevision: input.pending.baseRevision,
    messages: input.snapshot.messages, graphRevision: graph.revision,
  });
  const matchingQuestion = freshness.status === 'fresh' && frozen
    && freshness.questionContext.actionId === frozen.question.id
    && freshness.questionContext.topicId === frozen.target.id
    && freshness.presentation.turnId === frozen.question.presentingTurnId
    && freshness.presentation.assistantMessageId === frozen.question.presentingMessageId
    && freshness.presentation.planningStateRevision === frozen.question.presentationRevision;
  return { beginMatches, matchingQuestion: Boolean(matchingQuestion) };
}
