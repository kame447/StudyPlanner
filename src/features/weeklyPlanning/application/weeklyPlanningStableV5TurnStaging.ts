import { userUtteranceContextFactsV5 } from './weeklyPlanningStableV5ContextFacts';
export { userUtteranceContextFactsV5 } from './weeklyPlanningStableV5ContextFacts';
import { stageUserPlanningContextFactsV1 } from '../../userPlanningContext/userPlanningContextSpace';
import { collectUserPlanningContextFactsV5 } from '../semantic/weeklyPlanningDurableContextSignalsV5';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';
import type { WeeklyPlanningStableV5SemanticTurnResult } from './weeklyPlanningStableV5SemanticTurn';
import { commitWeeklyPlanningStableV5RuntimeGraph } from './weeklyPlanningStableV5RuntimeSession';

type SuccessfulSemanticTurn = Extract<
  WeeklyPlanningStableV5SemanticTurnResult,
  { status: 'success' }
>;

export function stageWeeklyPlanningStableV5Turn(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  semanticTurn: SuccessfulSemanticTurn;
  /** C5 records its bounded durable outcome separately; its fact-selection evidence is private. */
  omitCanonicalizationEvidence?: boolean;
}): void {
  const { input, semanticTurn } = params;
  const { requestContext, runtimeSession, semantic } = semanticTurn;
  const userContextFacts = userUtteranceContextFactsV5({
    facts: semantic.normalization.document
      ? collectUserPlanningContextFactsV5(semantic.normalization.document)
      : [],
    userText: input.userText,
    supplementalContext: input.supplementalContext,
  });

  stageUserPlanningContextFactsV1({
    ownerId: input.userId,
    conversationId: input.conversationId,
    requestId: input.traceRequestId,
    observedDate: requestContext.currentDate,
    facts: userContextFacts,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_user_context_staged',
    data: {
      ownerId: input.userId,
      conversationId: input.conversationId,
      requestId: input.traceRequestId,
      observedDate: requestContext.currentDate,
      userContextFacts,
    },
  });

  commitWeeklyPlanningStableV5RuntimeGraph({
    ownerId: input.userId,
    conversationId: input.conversationId,
    graph: semantic.graph,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_graph_staged',
    data: {
      ownerId: input.userId,
      conversationId: input.conversationId,
      requestId: input.traceRequestId,
      previousGraphRevision: runtimeSession.graph.revision,
      stagedGraph: semantic.graph,
      canonicalization: params.omitCanonicalizationEvidence ? null : semantic.canonicalization,
    },
  });
}
