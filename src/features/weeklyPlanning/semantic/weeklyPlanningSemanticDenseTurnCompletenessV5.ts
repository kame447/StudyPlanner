import type {
  ChatMessage,
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { runGenericSemanticRepairRouteV5 } from './weeklyPlanningSemanticGenericRepairRouteV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import {
  SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES,
  semanticNormalizerErrorMessage,
  type WeeklyPlanningSemanticNormalizerRunV5,
} from './weeklyPlanningSemanticNormalizerRunV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

export const DENSE_TURN_COMPLETENESS_AUDIT_MAX_COMPLETION_TOKENS = 3200;

export const DENSE_TURN_COMPLETENESS_AUDIT_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_dense_turn_completeness_audit_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'missingFacts'],
      properties: {
        decision: {
          type: 'string',
          enum: ['complete', 'incomplete'],
        },
        missingFacts: {
          type: 'array',
          maxItems: 12,
          items: {
            type: 'string',
            minLength: 1,
            maxLength: 240,
          },
        },
      },
    },
  },
};

const AUDIT_SYSTEM_PROMPT = [
  'Audit semantic coverage only. Do not schedule, repair, rewrite, or add meaning.',
  'Compare exact currentUserText with candidateDocument, which is already schema-valid.',
  'Return incomplete only when an explicit current-turn proposition that the weekly-planning semantic contract supports is missing from candidateDocument.',
  'Supported proposition families include planning window, requested tasks/materials/components, workload quantities, effort estimates, task timing/deadlines, recurrence/habits, plan-wide availability or unavailability, ordering/priority relations, durable study goal or goal-event or concern context, corrections, decisions, and explicit uncertainties.',
  'Do not require unsupported measurements to become schedulable facts. In particular, assessment/mock-exam scores are evidence about performance, not textbook completion, and daily total capacity without a clock window may remain unrepresented when the schema has no safe capacity fact.',
  'Equivalent broader representation counts as covered when it preserves the stated meaning. Do not demand redundant duplicates or exact sourceText wording.',
  'For incomplete, list concise summaries of only the missing supported propositions. Never invent facts.',
  'For complete, missingFacts must be an empty array.',
].join('\n');

export interface DenseTurnCompletenessAuditDecisionV5 {
  decision: 'complete' | 'incomplete';
  missingFacts: string[];
}

function textByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function denseTurnCompletenessAuditEligibleV5(userText: string): boolean {
  return textByteLength(userText) >= SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES;
}

export function createDenseTurnCompletenessAuditMessagesV5(params: {
  userText: string;
  candidateDocument: WeeklyPlanningSemanticDocumentV5;
}): ChatMessage[] {
  return [
    { role: 'system', content: AUDIT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        currentUserText: params.userText,
        candidateDocument: params.candidateDocument,
      }),
    },
  ];
}

export function parseDenseTurnCompletenessAuditDecisionV5(
  rawResponse: string,
): DenseTurnCompletenessAuditDecisionV5 | null {
  try {
    const value = JSON.parse(rawResponse) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.decision !== 'complete' && record.decision !== 'incomplete') return null;
    if (!Array.isArray(record.missingFacts)) return null;
    const missingFacts = record.missingFacts.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    ).map((item) => item.trim());
    if (missingFacts.length !== record.missingFacts.length || missingFacts.length > 12) return null;
    if (record.decision === 'complete' && missingFacts.length !== 0) return null;
    if (record.decision === 'incomplete' && missingFacts.length === 0) return null;
    return {
      decision: record.decision,
      missingFacts,
    };
  } catch {
    return null;
  }
}

export function createDenseTurnCompletenessRetryMessagesV5(params: {
  baseMessages: ChatMessage[];
  priorResponse: string;
  userText: string;
  missingFacts: readonly string[];
}): ChatMessage[] {
  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.priorResponse },
    {
      role: 'user',
      content: [
        'The prior semantic document is schema-valid but a separate coverage audit found supported current-turn propositions missing.',
        `The exact current userText is ${JSON.stringify(params.userText)}.`,
        `Coverage-audit hints: ${JSON.stringify(params.missingFacts)}.`,
        'Re-read the exact current userText independently and return one complete semantic document, not a patch.',
        'Preserve all correct facts from the prior document while adding every supported explicit proposition that was omitted.',
        'Do not convert assessment/mock-exam scores into material completion or workload progress.',
        'Do not invent unsupported dates, times, capacities, progress, relations, or task references.',
      ].join(' '),
    },
  ];
}

function completenessAuditFailureResult(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  providerError: string;
}): WeeklyPlanningSemanticNormalizerResultV5 {
  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'provider_failure',
    document: null,
    diagnostics: params.run.diagnostics({
      attemptCount: 1,
      repairAttempted: false,
      validationErrors: [],
      providerError: params.providerError,
    }),
  };
  params.run.recordDecision(result, {
    route: 'dense_turn_completeness_audit_failure',
    severity: 'error',
  });
  return result;
}

export async function tryWeeklyPlanningDenseTurnCompletenessRetryV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  baseMessages: ChatMessage[];
  initialResponse: string;
  initialDocument: WeeklyPlanningSemanticDocumentV5;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  if (!denseTurnCompletenessAuditEligibleV5(params.run.input.userText)) return null;

  const auditMessages = createDenseTurnCompletenessAuditMessagesV5({
    userText: params.run.input.userText,
    candidateDocument: params.initialDocument,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_orchestrator_route',
    data: {
      route: 'dense_turn_completeness_audit',
      meaningOwner: 'ai',
      deterministicResponsibilities: [
        'gate_dense_turns_by_size',
        'retry_when_ai_reports_supported_semantic_omissions',
      ],
    },
  });

  let auditRawResponse: string;
  try {
    auditRawResponse = await params.run.callTracked({
      messages: auditMessages,
      temperature: 0,
      responseFormat: DENSE_TURN_COMPLETENESS_AUDIT_RESPONSE_FORMAT_V5,
      purpose: 'weekly_planning_semantic_normalizer',
      maxCompletionTokens: DENSE_TURN_COMPLETENESS_AUDIT_MAX_COMPLETION_TOKENS,
    }, 'dense_completeness_audit');
  } catch (error) {
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: params.run.input.traceRequestId,
      stage: 'semantic_dense_turn_completeness_audit_result',
      severity: 'error',
      data: {
        accepted: false,
        error: semanticNormalizerErrorMessage(error),
      },
    });
    return completenessAuditFailureResult({
      run: params.run,
      providerError: `Dense semantic completeness audit failed: ${semanticNormalizerErrorMessage(error)}`,
    });
  }

  const audit = parseDenseTurnCompletenessAuditDecisionV5(auditRawResponse);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_dense_turn_completeness_audit_result',
    severity: audit ? 'info' : 'error',
    data: {
      accepted: Boolean(audit),
      decision: audit?.decision ?? null,
      missingFacts: audit?.missingFacts ?? [],
      rawResponse: auditRawResponse,
    },
  });
  if (!audit) {
    return completenessAuditFailureResult({
      run: params.run,
      providerError: 'Dense semantic completeness audit returned an invalid structured response.',
    });
  }
  if (audit.decision === 'complete') return null;

  const retryMessages = createDenseTurnCompletenessRetryMessagesV5({
    baseMessages: params.baseMessages,
    priorResponse: params.initialResponse,
    userText: params.run.input.userText,
    missingFacts: audit.missingFacts,
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_orchestrator_route',
    severity: 'warn',
    data: {
      route: 'dense_turn_completeness_retry',
      meaningOwner: 'ai',
      missingFacts: audit.missingFacts,
    },
  });

  let retryResponse: string;
  try {
    retryResponse = await params.run.callGeneric(retryMessages, 'dense_completeness_retry');
  } catch (error) {
    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'provider_failure',
      document: null,
      diagnostics: params.run.diagnostics({
        attemptCount: 2,
        repairAttempted: false,
        validationErrors: [],
        providerError: semanticNormalizerErrorMessage(error),
      }),
    };
    params.run.recordDecision(result, {
      route: 'dense_turn_completeness_retry_provider_failure',
      severity: 'error',
    });
    return result;
  }

  const retryValidation = validateWeeklyPlanningSemanticResponseV5(
    retryResponse,
    { publicStateSummary: params.run.input.publicStateSummary },
  );
  params.run.addAlgorithmicRepairs(retryValidation.algorithmicRepairs);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_validation_result',
    severity: retryValidation.document ? 'info' : 'error',
    data: {
      attempt: 'dense_completeness_retry',
      accepted: Boolean(retryValidation.document),
      errors: retryValidation.errors,
      algorithmicRepairs: retryValidation.algorithmicRepairs,
      parsedDocument: retryValidation.parsedDocument,
    },
  });

  if (!retryValidation.document) {
    return runGenericSemanticRepairRouteV5({
      run: params.run,
      baseMessages: params.baseMessages,
      initialResponse: retryResponse,
      initialValidation: retryValidation,
      attemptCountBeforeRepair: 2,
    });
  }

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: retryValidation.document,
    diagnostics: params.run.diagnostics({
      attemptCount: 2,
      repairAttempted: false,
      validationErrors: [],
      providerError: null,
    }),
  };
  params.run.recordDecision(result, {
    route: 'dense_turn_completeness_retry',
    extra: { missingFacts: audit.missingFacts },
  });
  return result;
}
