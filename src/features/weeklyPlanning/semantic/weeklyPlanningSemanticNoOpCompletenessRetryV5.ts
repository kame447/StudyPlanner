import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import {
  SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
  semanticNormalizerErrorDetails,
  type WeeklyPlanningSemanticNormalizerRunV5,
} from './weeklyPlanningSemanticNormalizerRunV5';
import { WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5 } from './weeklyPlanningSemanticProviderResponseFormatV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

const COMPLETENESS_RETRY_INSTRUCTION = [
  'The prior response is schema-valid but contains no new semantic content while a machine pending question exists.',
  'Re-read current userText from the prior user context independently and return the complete semantic document again.',
  'Include every supported explicit current-turn fact, including side contributions unrelated to the pending question. Do not invent facts.',
  'If the current turn truly contains no supported new fact, return equivalent no-op meaning.',
].join(' ');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasMachinePendingQuestion(summary: Record<string, unknown> | undefined): boolean {
  if (!summary || !isRecord(summary.pendingQuestion)) return false;
  return typeof summary.pendingQuestion.questionCode === 'string';
}

function hasTaskSemanticPayload(document: WeeklyPlanningSemanticDocumentV5): boolean {
  return document.tasks.some((task) => {
    if (!task.existingPublicId) return true;
    if (
      task.workloads.length > 0
      || task.effortEstimates.length > 0
      || task.temporalConstraints.length > 0
      || task.recurrence.length > 0
      || (task.durableContextSignals?.length ?? 0) > 0
    ) return true;

    return (task.study?.components ?? []).some((component) =>
      !component.existingPublicId
      || component.workloads.length > 0
      || (component.durableContextSignals?.length ?? 0) > 0);
  });
}

function acceptedPriorResult(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  document: WeeklyPlanningSemanticDocumentV5;
  attemptCount: number;
  repairAttempted: boolean;
  validationErrors: string[];
}): WeeklyPlanningSemanticNormalizerResultV5 {
  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: params.document,
    diagnostics: params.run.diagnostics({
      attemptCount: params.attemptCount,
      repairAttempted: params.repairAttempted,
      validationErrors: params.validationErrors,
      providerError: null,
    }),
  };
  params.run.recordDecision(result, { route: 'schema_valid_noop_completeness_retry_fallback_initial' });
  return result;
}

export function isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  publicStateSummary?: Record<string, unknown>;
}): boolean {
  if (!hasMachinePendingQuestion(params.publicStateSummary)) return false;
  const document = params.document;
  if (
    document.planningWindow
    || document.relations.length > 0
    || document.availabilityDeclarations.length > 0
    || document.constraintSourceRequests.length > 0
    || (document.userContextFacts?.length ?? 0) > 0
    || document.uncertainties.length > 0
    || document.corrections.length > 0
    || document.decisions.length > 0
  ) return false;
  return !hasTaskSemanticPayload(document);
}

export async function tryWeeklyPlanningSemanticNoOpCompletenessRetryV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  baseMessages: ChatMessage[];
  initialResponse: string;
  initialDocument: WeeklyPlanningSemanticDocumentV5;
  attemptCountBeforeRetry?: number;
  repairAttempted?: boolean;
  validationErrors?: string[];
}): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  if (!isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
    document: params.initialDocument,
    publicStateSummary: params.run.input.publicStateSummary,
  })) return null;

  const attemptCount = (params.attemptCountBeforeRetry ?? 1) + 1;
  const repairAttempted = params.repairAttempted ?? false;
  const validationErrors = params.validationErrors ?? [];
  const messages: ChatMessage[] = [
    ...params.baseMessages,
    { role: 'assistant', content: params.initialResponse },
    { role: 'user', content: COMPLETENESS_RETRY_INSTRUCTION },
  ];
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_orchestrator_route',
    data: {
      route: 'schema_valid_noop_completeness_retry',
      meaningOwner: 'ai',
      deterministicResponsibilities: [
        'detect_schema_valid_semantic_noop_under_machine_pending_question',
      ],
      attemptCountBeforeRetry: params.attemptCountBeforeRetry ?? 1,
      repairAttempted,
    },
  });

  let response: string;
  try {
    response = await params.run.callTracked({
      messages,
      temperature: 0,
      responseFormat: WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5,
      purpose: 'weekly_planning_semantic_normalizer',
      maxCompletionTokens: SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
    }, 'completeness_retry');
  } catch (error) {
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: params.run.input.traceRequestId,
      stage: 'semantic_noop_completeness_retry_result',
      severity: 'warn',
      data: {
        accepted: false,
        fallback: 'initial_schema_valid_document',
        error: semanticNormalizerErrorDetails(error),
      },
    });
    return acceptedPriorResult({
      run: params.run,
      document: params.initialDocument,
      attemptCount,
      repairAttempted,
      validationErrors,
    });
  }

  const validation = validateWeeklyPlanningSemanticResponseV5(
    response,
    { publicStateSummary: params.run.input.publicStateSummary },
  );
  params.run.addAlgorithmicRepairs(validation.algorithmicRepairs);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_noop_completeness_retry_result',
    severity: validation.document ? 'info' : 'warn',
    data: {
      accepted: Boolean(validation.document),
      errors: validation.errors,
      parsedDocument: validation.parsedDocument,
      fallback: validation.document ? null : 'initial_schema_valid_document',
    },
  });
  if (!validation.document) {
    return acceptedPriorResult({
      run: params.run,
      document: params.initialDocument,
      attemptCount,
      repairAttempted,
      validationErrors,
    });
  }

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: validation.document,
    diagnostics: params.run.diagnostics({
      attemptCount,
      repairAttempted,
      validationErrors,
      providerError: null,
    }),
  };
  params.run.recordDecision(result, { route: 'schema_valid_noop_completeness_retry' });
  return result;
}
