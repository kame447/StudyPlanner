import { resolveWeeklyPlanningQuestionPresentationFreshness, type WeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  resolveWeeklyPlanningDateExpressionsV5,
} from '../semantic/weeklyPlanningResolvedDateExpressionsV5';
import {
  resolveWeeklyPlanningTemporalConstraintsV5,
} from '../semantic/weeklyPlanningResolvedTemporalConstraintsV5';
import type { selectReplyReferenceHintV5 } from '../semantic/weeklyPlanningReplyReferenceChoiceV5';
import type { ReplyReferenceCandidateV5 } from '../semantic/weeklyPlanningReplyReferenceCandidatesV5';
import type { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import {
  createWeeklyPlanningSemanticPipelineV5,
  type WeeklyPlanningSemanticPipelineResultV5,
} from '../semantic/weeklyPlanningSemanticPipelineV5';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import { projectStableV5CompatibilityOutput } from './weeklyPlanningStableV5CompatibilityState';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';
import {
  activeStableV5PlanningWindows,
  createStableV5SemanticPublicStateSummary,
  stableV5RequestContextForInput,
  STABLE_V5_RECENT_TURN_LIMIT,
} from './weeklyPlanningStableV5SemanticContextCore';
import {
  createWeeklyPlanningSchedulerContext,
  resolveWeeklyPlanningPlanningHorizon,
  type WeeklyPlanningTurnRequestContext,
} from './weeklyPlanningTemporalContext';
import {
  type WeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';

export type WeeklyPlanningStableV5SemanticTurnResult =
  | {
      status: 'success';
      pendingQuestionPresentation: WeeklyPlanningQuestionPresentationFreshness;
      requestContext: WeeklyPlanningTurnRequestContext;
      runtimeSession: WeeklyPlanningStableV5RuntimeSession;
      semantic: WeeklyPlanningSemanticPipelineResultV5;
    }
  | {
      status: 'failure';
      output: WeeklyPlanningTurnExecutionResult;
    };

function semanticFailureOutput(params: {
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
  branch: 'provider_failure' | 'normalization_rejected' | 'canonicalization_rejected';
  message: string;
  basis: unknown;
}): WeeklyPlanningTurnExecutionResult {
  const output = projectStableV5CompatibilityOutput({
    previousState: params.input.previousState,
    userText: params.input.userText,
    message: params.message,
    draftCandidates: [],
    authorized: false,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'runtime_branch_selected',
    severity: 'error',
    data: {
      branch: params.branch,
      basis: params.basis,
      output,
    },
  });
  return output;
}

export async function executeWeeklyPlanningStableV5SemanticTurnCore(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
  ports: {
    normalizer: ReturnType<typeof createWeeklyPlanningSemanticNormalizerV5>;
    session: WeeklyPlanningStableV5RuntimeSession;
    selectContext: NonNullable<Parameters<typeof createStableV5SemanticPublicStateSummary>[1]>;
    recordFailure: NonNullable<Parameters<typeof createWeeklyPlanningSemanticPipelineV5>[1]>;
    resolveReplyReferenceHint?: (args: Pick<Parameters<typeof selectReplyReferenceHintV5>[0],
      'source' | 'readCurrent' | 'userText' | 'ownerId' | 'conversationId' | 'requestId'>)
      => Promise<ReplyReferenceCandidateV5 | null>;
  },
): Promise<WeeklyPlanningStableV5SemanticTurnResult> {
  const temporal = stableV5RequestContextForInput(input);
  const requestContext = temporal.context;
  const runtimeSession = ports.session;
  if (runtimeSession.ownerId !== input.userId || runtimeSession.conversationId !== input.conversationId) {
    throw new Error('Stable V5 runtime session owner mismatch.');
  }
  const pendingQuestionPresentation = resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: input.previousState, inputStateRevision: input.inputStateRevision,
    messages: input.messages, graphRevision: runtimeSession.graph.revision,
  });
  const activeWindowsBefore = activeStableV5PlanningWindows(runtimeSession.graph);
  const activeSchedulerGraphBefore = createWeeklyPlanningActiveSchedulerGraphViewV5(
    runtimeSession.graph,
  );
  const resolvedDateExpressionsBefore = resolveWeeklyPlanningDateExpressionsV5({
    graph: activeSchedulerGraphBefore,
    currentDate: requestContext.currentDate,
    weekStartsOn: requestContext.weekStartsOn,
  });
  const resolvedTemporalConstraintsBefore = resolveWeeklyPlanningTemporalConstraintsV5({
    graph: activeSchedulerGraphBefore,
    currentDate: requestContext.currentDate,
    weekStartsOn: requestContext.weekStartsOn,
    resolvedDateExpressions: resolvedDateExpressionsBefore,
  });
  const fallbackHorizon = resolveWeeklyPlanningPlanningHorizon({
    graph: activeSchedulerGraphBefore,
    selectedDate: input.selectedDate,
    requestContext,
    resolvedTemporalConstraints: resolvedTemporalConstraintsBefore,
    groundingRecords: input.previousState?.groundingRecords,
  });
  const recentConversation = input.messages
    .slice(-STABLE_V5_RECENT_TURN_LIMIT)
    .map(({ role, content }) => ({ role, content }));
  const stateSummary = createStableV5SemanticPublicStateSummary({
    graph: runtimeSession.graph,
    messages: input.messages,
    previousState: input.previousState,
    ownerId: input.userId,
    inputStateRevision: input.inputStateRevision,
    currentDate: requestContext.currentDate,
    userText: input.userText,
    studyMaterials: input.studyMaterials ?? [],
  }, ports.selectContext);
  if (ports.resolveReplyReferenceHint && !input.supplementalContext?.trim()
    && !input.selectedStarterTarget && input.inputStateRevision !== undefined) {
    const readReferenceSource = () => ({
      graph: runtimeSession.graph, messages: input.messages,
      previousState: input.previousState, inputStateRevision: input.inputStateRevision,
    });
    try {
      const selected = await ports.resolveReplyReferenceHint({
        source: readReferenceSource(), readCurrent: readReferenceSource,
        userText: input.userText, ownerId: input.userId,
        conversationId: input.conversationId, requestId: input.traceRequestId,
      });
      if (selected) {
        stateSummary.replyReferenceHint = {
          sourceMessageId: selected.sourceMessageId,
          targetKind: selected.targetKind,
          targetFactId: selected.targetFactId,
          taskFactId: selected.taskFactId,
          componentPath: selected.componentPath,
          slot: selected.slot, operation: selected.operation,
          graphRevision: runtimeSession.graph.revision,
          authority: 'non_authoritative_semantic_hint',
        };
      }
    } catch {
      // A Jev routing failure leaves the full utterance to the existing Luna path.
    }
  }
  const initialSchedulerContext = createWeeklyPlanningSchedulerContext({
    ownerId: input.userId,
    horizon: fallbackHorizon,
    requestContext,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_session_context_prepared',
    data: {
      runtimeSession,
      graphRevision: runtimeSession.graph.revision,
      activePlanningWindows: activeWindowsBefore,
      selectedDate: input.selectedDate,
      requestContext,
      requestContextSource: temporal.source,
      resolvedDateExpressions: resolvedDateExpressionsBefore,
      resolvedTemporalConstraints: resolvedTemporalConstraintsBefore,
      fallbackHorizon,
      horizonCriteria: {
        moreThanOneActiveWindow: 'return null',
        noActiveWindow: 'selectedDate is display/fallback seed only',
        explicitStartEnd: 'valid dates and start <= end',
        groundedRelativeWindow: 'reuse the persisted absolute grounding range until the source fact is corrected',
        otherwise: 'resolveCanonicalDateExpression(window.value, requestContext.currentDate, weekStartsOn)',
      },
      recentTurnLimit: STABLE_V5_RECENT_TURN_LIMIT,
      recentConversation,
      publicStateSummary: stateSummary,
      schedulerContext: initialSchedulerContext,
    },
  });

  const semantic = await createWeeklyPlanningSemanticPipelineV5(
    ports.normalizer, ports.recordFailure,
  ).run({
    graph: runtimeSession.graph,
    conversationId: input.conversationId,
    turnId: input.traceRequestId,
    expectedRevision: runtimeSession.graph.revision,
    userText: input.userText,
    supplementalContext: input.supplementalContext,
    selectedStarterTarget: input.selectedStarterTarget,
    recentConversation,
    publicStateSummary: stateSummary,
    schedulerContext: initialSchedulerContext,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_semantic_result_received',
    severity: semantic.status === 'normalization_rejected'
      || semantic.status === 'provider_failure'
      || semantic.status === 'canonicalization_rejected'
      ? 'error'
      : 'info',
    data: semantic,
  });

  if (semantic.status === 'provider_failure') {
    return {
      status: 'failure',
      output: semanticFailureOutput({
        input,
        branch: 'provider_failure',
        message: 'AIに接続できなかったため、入力内容は変更していません。接続を確認してもう一度送ってください。',
        basis: { semanticStatus: semantic.status },
      }),
    };
  }
  if (semantic.status === 'normalization_rejected') {
    return {
      status: 'failure',
      output: semanticFailureOutput({
        input,
        branch: 'normalization_rejected',
        message: 'こちらの処理で内容を安全に整理できなかったため、予定条件には反映していません。まず、いつの予定を作るか、または何を進めるかを一つだけ教えてください。',
        basis: { semanticStatus: semantic.status, normalization: semantic.normalization },
      }),
    };
  }
  if (semantic.status === 'canonicalization_rejected') {
    return {
      status: 'failure',
      output: semanticFailureOutput({
        input,
        branch: 'canonicalization_rejected',
        message: '直前の会話状態と構造化結果が一致しなかったため、変更は反映していません。直前に確認していた項目だけ、短く一つ教えてください。',
        basis: {
          semanticStatus: semantic.status,
          expectedRevision: runtimeSession.graph.revision,
          actualInputGraphRevision: runtimeSession.graph.revision,
          canonicalization: semantic.canonicalization,
        },
      }),
    };
  }

  return {
    status: 'success',
    pendingQuestionPresentation,
    requestContext,
    runtimeSession,
    semantic,
  };
}
