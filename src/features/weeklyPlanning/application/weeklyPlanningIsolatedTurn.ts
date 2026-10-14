import { boundWeeklyPlanningDialogueRendererTraceForTransport } from '../trace/weeklyPlanningDialogueRendererTrace';
import { capturePlanningTurnContext, snapshotContextValue } from '../harness/planningContextSnapshot';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanningTurnExecutionInput, WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { UserPlanningContextRecordV1, UserPlanningContextSemanticFactV1 } from '../../userPlanningContext/userPlanningContextTypes';
import { selectUserPlanningContextPromptRecordsV2 } from '../../userPlanningContext/userPlanningContextPromptSelectionV2Core';
import { executeWeeklyPlanningStableV5SemanticTurnCore } from './weeklyPlanningStableV5SemanticTurnCore';
import { executeWeeklyPlanningStableV5RuntimeTurnCore } from './weeklyPlanningStableV5RuntimeExecutorCore';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { createWeeklyPlanningStableV5FailureDiagnostics, type WeeklyPlanningStableV5RecordedFailure } from '../semantic/weeklyPlanningStableV5FailureDiagnostics';
import { projectWeeklyPlanningStableV5TurnResultCore } from './weeklyPlanningStableV5TurnResultProjectionCore';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../dialogue/weeklyPlanningStableV5AiDialogueRendererCore';
import { withRepairSafePreview } from './weeklyPlanningStableV5ResultProjection';
import { collectUserPlanningContextFactsV5 } from '../semantic/weeklyPlanningDurableContextSignalsV5';
import { userUtteranceContextFactsV5 } from './weeklyPlanningStableV5ContextFacts';
import { clearWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';

export interface IsolatedWeeklyPlanningTurnInput {
  input: Omit<WeeklyPlanningTurnExecutionInput, 'isCurrentTurn' | 'requestContext' | 'semanticObservation'> & { requestContext: WeeklyPlanningTurnRequestContext };
  graph: WeeklyPlanningFactGraphV5;
  userContextRecords: UserPlanningContextRecordV1[];
  weekStartDate: string;
}
export interface IsolatedWeeklyPlanningTurnResult {
  result: WeeklyPlanningTurnExecutionResult;
  stagedContextFacts: UserPlanningContextSemanticFactV1[];
  observedDate: string;
}

/** The existing semantic → deterministic planning → rendering flow with invocation-local state.
 * This function never finalizes a browser graph, writes memory, approves, or saves a Plan.
 */
export async function executeIsolatedWeeklyPlanningTurn(
  payload: IsolatedWeeklyPlanningTurnInput,
  client: OpenAiCompatibleClient,
): Promise<IsolatedWeeklyPlanningTurnResult> {
  const input = capturePlanningTurnContext({ ...payload.input, isCurrentTurn: () => true });
  const userContextRecords = snapshotContextValue(payload.userContextRecords);
  const session = { ownerId: input.userId, conversationId: input.conversationId,
    weekStartDate: payload.weekStartDate, graph: structuredClone(payload.graph), updatedAt: 0 };
  const promptContexts = new Map<string, Record<string, unknown>>();
  let graph = session.graph;
  let failure: WeeklyPlanningStableV5RecordedFailure | null = null;
  let stagedContextFacts: UserPlanningContextSemanticFactV1[] = [];
  try {
    const core = await executeWeeklyPlanningStableV5RuntimeTurnCore(input, {
      semanticTurn: (runtimeInput) => executeWeeklyPlanningStableV5SemanticTurnCore(runtimeInput, {
        normalizer: createWeeklyPlanningSemanticNormalizerV5(client), session,
        selectContext: ({ relevantScopeKeys }) => selectUserPlanningContextPromptRecordsV2({
          records: userContextRecords, relevantScopeKeys,
        }),
        recordFailure: (params) => { failure = createWeeklyPlanningStableV5FailureDiagnostics(params); },
      }),
      stageTurn: ({ semanticTurn }) => {
        graph = semanticTurn.semantic.graph;
        session.graph = graph;
        stagedContextFacts = userUtteranceContextFactsV5({
          facts: semanticTurn.semantic.normalization.document
            ? collectUserPlanningContextFactsV5(semanticTurn.semantic.normalization.document) : [],
          userText: input.userText, supplementalContext: input.supplementalContext,
        });
      },
    });
    let result = await projectWeeklyPlanningStableV5TurnResultCore({ input,
      result: withRepairSafePreview(input, { ...core, stableV5Graph: graph }),
    }, {
      takeFailure: () => { const value = failure; failure = null; return value; },
      dialogue: {
        createRenderer: (options) => createWeeklyPlanningStableV5DialogueRendererCore(client, {
          ...options,
          // Sampling evidence belongs to this invocation, not a process-global
          // actionId cache shared by concurrent owners on the Worker.
          rememberPrompt: (id, context) => { promptContexts.set(id, context); },
        }),
        getSession: (conversationId) => conversationId === session.conversationId ? structuredClone(session) : null,
      },
    });
    const trace = result.dialogueRendererTrace;
    const promptContext = trace?.actionId ? promptContexts.get(trace.actionId) : undefined;
    if (trace?.request && promptContext) {
      result = { ...result, dialogueRendererTrace: boundWeeklyPlanningDialogueRendererTraceForTransport({
        ...trace, request: { ...trace.request, promptContext },
      }) };
    }
    return { result, stagedContextFacts: result.failure ? [] : stagedContextFacts,
      observedDate: input.requestContext.currentDate };
  } finally {
    // Instrumentation is bounded, never a session authority. Dispose the invocation trace.
    clearWeeklyPlanningStableV5DebugTrace(input.traceRequestId);
  }
}
