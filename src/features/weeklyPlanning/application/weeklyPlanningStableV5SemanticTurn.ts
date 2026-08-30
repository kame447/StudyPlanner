import { getAiConfig, getAiConfigValidationMessage } from '../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  resolveWeeklyPlanningDateExpressionsV5,
} from '../semantic/weeklyPlanningResolvedDateExpressionsV5';
import {
  resolveWeeklyPlanningTemporalConstraintsV5,
} from '../semantic/weeklyPlanningResolvedTemporalConstraintsV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
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
} from './weeklyPlanningStableV5SemanticContext';
import {
  createWeeklyPlanningSchedulerContext,
  resolveWeeklyPlanningPlanningHorizon,
  type WeeklyPlanningTurnRequestContext,
} from './weeklyPlanningTemporalContext';
import {
  getOrCreateWeeklyPlanningStableV5RuntimeSession,
  type WeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';

export type WeeklyPlanningStableV5SemanticTurnResult =
  | {
      status: 'success';
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

export async function executeWeeklyPlanningStableV5SemanticTurn(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): Promise<WeeklyPlanningStableV5SemanticTurnResult> {
  const aiConfig = getAiConfig();
  const configError = getAiConfigValidationMessage(aiConfig);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'runtime_configuration_evaluated',
    severity: aiConfig.provider === 'rules' || configError ? 'error' : 'info',
    data: {
      provider: aiConfig.provider,
      baseUrl: aiConfig.baseUrl,
      model: aiConfig.model,
      configError,
      criteria: {
        rulesProviderRejected: true,
        validConfigurationRequired: true,
      },
    },
  });
  if (aiConfig.provider === 'rules' || configError) {
    throw new Error(configError ?? 'Stable V5にはAI structured output接続が必要です。');
  }

  const temporal = stableV5RequestContextForInput(input);
  const requestContext = temporal.context;
  const runtimeSession = getOrCreateWeeklyPlanningStableV5RuntimeSession({
    ownerId: input.userId,
    conversationId: input.conversationId,
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
    currentDate: requestContext.currentDate,
    userText: input.userText,
    studyMaterials: input.studyMaterials ?? [],
  });
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
    createWeeklyPlanningSemanticNormalizerV5(createOpenAiCompatibleClient(aiConfig)),
  ).run({
    graph: runtimeSession.graph,
    conversationId: input.conversationId,
    turnId: input.traceRequestId,
    expectedRevision: runtimeSession.graph.revision,
    userText: input.userText,
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
    requestContext,
    runtimeSession,
    semantic,
  };
}
