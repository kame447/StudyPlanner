import {
  applyValidatedRegisteredMaterialBudgetCompletionV5,
  parseRegisteredMaterialBudgetCompletionV5,
  registeredMaterialBudgetAccountsForAllOmissionsV5,
  registeredMaterialBudgetAuditFormatV5,
  registeredMaterialBudgetAuditLabelsV5,
  REGISTERED_MATERIAL_BUDGET_AUDIT_INSTRUCTION_V5,
} from './weeklyPlanningRegisteredMaterialBudgetCompletionV5';
import { validateWeeklyPlanningSemanticCompletenessPreservationV5, type WeeklyPlanningSemanticCompletenessAbstentionV5 } from './weeklyPlanningSemanticCompletenessPreservationV5';
import { isWeeklyPlanningTurnDispatchBudgetExceeded } from '../application/weeklyPlanningTurnDispatchBudget';
import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import {
  measureWeeklyPlanningSemanticEvidenceCoverageV5,
  type WeeklyPlanningSemanticEvidenceCoverageV5,
} from './weeklyPlanningSemanticEvidenceCoverageV5';
import { hasWeeklyPlanningEvidenceCoverageMissingEffortV5, hasWeeklyPlanningEvidenceCoverageTaskModificationV5 } from './weeklyPlanningSemanticEvidenceCoverageNeedV5';
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

const interactionCompletenessAuditRuns = new WeakSet<WeeklyPlanningSemanticNormalizerRunV5>();

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
  'Supported proposition families include planning window, requested tasks/materials/components, workload quantities, effort estimates, task timing/deadlines, recurrence/habits, plan-wide availability, unavailability, or daily capacity, ordering/priority relations, durable study goal or goal-event or concern context, corrections, decisions, and explicit uncertainties.',
  'Assessment/mock-exam scores are performance evidence, not textbook completion. A stated daily total capacity is supported: represent it as kind=capacity with capacityMinutes and its date/weekday scope, without inventing a clock window.',
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
  evidenceCoverageEligibility?: WeeklyPlanningSemanticEvidenceCoverageV5;
}): ChatMessage[] {
  return [
    { role: 'system', content: AUDIT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        ...(params.evidenceCoverageEligibility ? { evidenceCoverageEligibility: params.evidenceCoverageEligibility } : {}),
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
        'Do not invent unsupported dates, times, progress, relations, task references, or unstated capacities.',
      ].join(' '),
    },
  ];
}

function completenessAuditFailureResult(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  providerError: string;
  repairAttempted?: boolean;
}): WeeklyPlanningSemanticNormalizerResultV5 {
  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'provider_failure',
    document: null,
    diagnostics: params.run.diagnostics({
      attemptCount: 1,
      repairAttempted: Boolean(params.repairAttempted),
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
  semanticRepairConsumed?: () => boolean;
}): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  const initialAlgorithmicRepairs = [...params.run.algorithmicRepairs];
  const dense = denseTurnCompletenessAuditEligibleV5(params.run.input.userText);
  const taskModification = !dense
    && conversationArchitecturePolicy(params.run.input.conversationArchitecture).semanticConversationActs
    && hasWeeklyPlanningEvidenceCoverageTaskModificationV5({
      document: params.initialDocument, committedGraph: params.run.input.committedGraph,
    });
  let evidenceCoverageEligibility = !dense
    && conversationArchitecturePolicy(params.run.input.conversationArchitecture).semanticConversationActs
    ? measureWeeklyPlanningSemanticEvidenceCoverageV5({
        userText: params.run.input.userText, document: params.initialDocument,
        ...(taskModification ? { boundedNumericSourceTexts: true, committedGraph: params.run.input.committedGraph } : {}),
      })
    : undefined;
  if (evidenceCoverageEligibility?.eligible) evidenceCoverageEligibility = {
    ...evidenceCoverageEligibility,
    eligible: hasWeeklyPlanningEvidenceCoverageMissingEffortV5({
      document: params.initialDocument, committedGraph: params.run.input.committedGraph,
    }) || taskModification,
  };
  if (evidenceCoverageEligibility) recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.run.input.traceRequestId,
    stage: 'semantic_evidence_coverage_eligibility',
    data: evidenceCoverageEligibility,
  });
  if (!dense && !evidenceCoverageEligibility?.eligible) return null;
  if (conversationArchitecturePolicy(params.run.input.conversationArchitecture).semanticConversationActs) {
    if (interactionCompletenessAuditRuns.has(params.run)) return null;
    interactionCompletenessAuditRuns.add(params.run);
  }
  const abstain = (reason: 'provider_failure' | 'malformed_audit_response' | 'dispatch_budget_exhausted' | 'initial_facts_not_preserved' | 'repair_budget_consumed', step: 'audit' | 'retry') => {
    if (!evidenceCoverageEligibility) return;
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: params.run.input.traceRequestId,
      stage: 'semantic_evidence_coverage_abstained',
      data: { route: evidenceCoverageEligibility.route, reason, step },
    });
  };

  const retainsInitialFacts = (document: WeeklyPlanningSemanticDocumentV5) => !evidenceCoverageEligibility
    || validateWeeklyPlanningSemanticCompletenessPreservationV5({
      userText: params.run.input.userText, initialDocument: params.initialDocument, retryDocument: document,
    }).length === 0;
  const retainedInitialResult = (attemptCount: number, repairAttempted: boolean, reason: WeeklyPlanningSemanticCompletenessAbstentionV5['reason'] = 'initial_facts_not_preserved') => {
    abstain(reason, 'retry');
    // Keep the actual accepted floor in the existing validation slot. Persisted
    // diagnostics retain only two validation results; raw responses keep the retry.
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: params.run.input.traceRequestId, stage: 'semantic_validation_result',
      severity: 'warn', data: { attempt: `completeness_floor:${reason}`, accepted: true, errors: [], parsedDocument: params.initialDocument, conversationActs: params.initialDocument.conversationActs ?? [] },
    });
    const result: WeeklyPlanningSemanticNormalizerResultV5 & { completenessAbstention: WeeklyPlanningSemanticCompletenessAbstentionV5 } = {
      status: 'accepted', document: params.initialDocument,
      completenessAbstention: { reason },
      diagnostics: { ...params.run.diagnostics({ attemptCount, repairAttempted: repairAttempted || Boolean(params.semanticRepairConsumed?.()), validationErrors: [], providerError: null }),
        algorithmicRepairs: initialAlgorithmicRepairs },
    };
    params.run.recordDecision(result, { route: 'completeness_retry_initial_facts_retained' });
    return result;
  };

  const auditMessages = createDenseTurnCompletenessAuditMessagesV5({
    userText: params.run.input.userText,
    candidateDocument: params.initialDocument,
    evidenceCoverageEligibility,
  });
  const budgetLabels = conversationArchitecturePolicy(params.run.input.conversationArchitecture).semanticConversationActs
    && ['create_plan', 'update_plan'].includes(params.initialDocument.planningIntent)
    ? registeredMaterialBudgetAuditLabelsV5(params.run.input.publicStateSummary) : [];
  const budgetAuditEnabled = budgetLabels.length > 0;
  if (budgetAuditEnabled) {
    // Only the named exception can author meaning; other coverage findings stay advisory.
    auditMessages[0] = { ...auditMessages[0], content: auditMessages[0].content.replace(
      'Audit semantic coverage only. Do not schedule, repair, rewrite, or add meaning.',
      'Audit semantic coverage. Do not schedule, repair or rewrite candidateDocument. Only the named registered-material timebox exception below may author an additive semantic candidate.',
    ) + '\n' + REGISTERED_MATERIAL_BUDGET_AUDIT_INSTRUCTION_V5 };
    const auditInput = JSON.parse(auditMessages[1].content) as Record<string, unknown>;
    auditMessages[1] = { ...auditMessages[1], content: JSON.stringify({ ...auditInput,
      registeredMaterialLabels: budgetLabels, acceptedTasks: params.run.input.publicStateSummary?.tasks ?? [],
    }) };
  }
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
      responseFormat: budgetAuditEnabled
        ? registeredMaterialBudgetAuditFormatV5(DENSE_TURN_COMPLETENESS_AUDIT_RESPONSE_FORMAT_V5)
        : DENSE_TURN_COMPLETENESS_AUDIT_RESPONSE_FORMAT_V5,
      purpose: 'weekly_planning_semantic_normalizer',
      maxCompletionTokens: DENSE_TURN_COMPLETENESS_AUDIT_MAX_COMPLETION_TOKENS,
    }, 'dense_completeness_audit');
  } catch (error) {
    // The turn's shared dispatch budget ran out: keep the valid initial document; budget
    // exhaustion is never reported as a connectivity failure.
    if (isWeeklyPlanningTurnDispatchBudgetExceeded(error)) {
      abstain('dispatch_budget_exhausted', 'audit');
      return null;
    }
    if (evidenceCoverageEligibility) {
      abstain('provider_failure', 'audit');
      return null;
    }
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
      repairAttempted: Boolean(params.semanticRepairConsumed?.()),
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
    if (evidenceCoverageEligibility) {
      abstain('malformed_audit_response', 'audit');
      return null;
    }
    return completenessAuditFailureResult({
      run: params.run,
      repairAttempted: Boolean(params.semanticRepairConsumed?.()),
      providerError: 'Dense semantic completeness audit returned an invalid structured response.',
    });
  }
  if (audit.decision === 'complete') return null;

  const budgetCompletion = budgetAuditEnabled
    ? parseRegisteredMaterialBudgetCompletionV5(auditRawResponse, audit.missingFacts.length) : null;
  const applyBudgetCompletion = (document: WeeklyPlanningSemanticDocumentV5, phase: 'initial' | 'reread' | 'repair') => {
    if (!budgetCompletion) return { document, acceptedOmissionIndexes: [] };
    const completed = applyValidatedRegisteredMaterialBudgetCompletionV5({
      document, completion: budgetCompletion, phase,
      input: {
        currentUserText: params.run.input.userText, supplementalContext: params.run.input.supplementalContext,
        selectedStarterTarget: params.run.input.selectedStarterTarget, recentConversation: params.run.input.recentConversation,
        publicStateSummary: params.run.input.publicStateSummary, committedGraph: params.run.input.committedGraph,
        conversationArchitecture: params.run.input.conversationArchitecture,
      },
    });
    if (phase !== 'initial' || completed.acceptedOmissionIndexes.length === 0
      || registeredMaterialBudgetAccountsForAllOmissionsV5(budgetCompletion, completed.acceptedOmissionIndexes)) recordWeeklyPlanningStableV5DebugTrace({
      requestId: params.run.input.traceRequestId, stage: 'semantic_orchestrator_route',
      data: { route: 'audit_authored_registered_material_timebox', phase, meaningOwner: 'ai',
        interpretationAuthor: 'completeness_audit',
        applied: completed.document !== document && (phase !== 'initial'
          || registeredMaterialBudgetAccountsForAllOmissionsV5(budgetCompletion, completed.acceptedOmissionIndexes)),
        decisions: completed.decisions },
    });
    return completed;
  };
  const finalizeBudgetCompletion = <T extends WeeklyPlanningSemanticNormalizerResultV5>(result: T, phase: 'reread' | 'repair'): T => {
    if (!result.document || !budgetCompletion) return result;
    const completed = applyBudgetCompletion(result.document, phase);
    if (completed.document === result.document) return result;
    const final = { ...result, document: completed.document };
    params.run.recordDecision(final, { route: 'audit_authored_registered_material_timebox_after_retention' });
    return final;
  };
  const initialCompletion = applyBudgetCompletion(params.initialDocument, 'initial');
  if (budgetCompletion && registeredMaterialBudgetAccountsForAllOmissionsV5(
    budgetCompletion, initialCompletion.acceptedOmissionIndexes,
  )) {
    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'accepted', document: initialCompletion.document,
      diagnostics: params.run.diagnostics({ attemptCount: 2, repairAttempted: Boolean(params.semanticRepairConsumed?.()), validationErrors: [], providerError: null }),
    };
    params.run.recordDecision(result, { route: 'audit_authored_registered_material_timebox' });
    return result;
  }

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
    if (isWeeklyPlanningTurnDispatchBudgetExceeded(error)) {
      abstain('dispatch_budget_exhausted', 'retry');
      return null;
    }
    if (evidenceCoverageEligibility) {
      abstain('provider_failure', 'retry');
      return null;
    }
    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'provider_failure',
      document: null,
      diagnostics: params.run.diagnostics({
        attemptCount: 2,
        repairAttempted: Boolean(params.semanticRepairConsumed?.()),
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
    {
      currentUserText: params.run.input.userText,
      supplementalContext: params.run.input.supplementalContext,
      selectedStarterTarget: params.run.input.selectedStarterTarget,
      recentConversation: params.run.input.recentConversation,
      publicStateSummary: params.run.input.publicStateSummary,
      committedGraph: params.run.input.committedGraph,
      conversationArchitecture: params.run.input.conversationArchitecture,
    },
  );
  params.run.addAlgorithmicRepairs(retryValidation.algorithmicRepairs);
  const retentionErrors = evidenceCoverageEligibility && retryValidation.document
    ? validateWeeklyPlanningSemanticCompletenessPreservationV5({
        userText: params.run.input.userText, initialDocument: params.initialDocument, retryDocument: retryValidation.document,
      }) : [];
  if (retryValidation.document && retentionErrors.length > 0) return finalizeBudgetCompletion(retainedInitialResult(2, false), 'reread');
  if (!retryValidation.document && conversationArchitecturePolicy(params.run.input.conversationArchitecture).semanticConversationActs && params.semanticRepairConsumed?.()) {
    return finalizeBudgetCompletion(retainedInitialResult(2, true, 'repair_budget_consumed'), 'reread');
  }
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
    const repaired = await runGenericSemanticRepairRouteV5({
      run: params.run,
      baseMessages: params.baseMessages,
      initialResponse: retryResponse,
      initialValidation: retryValidation,
      attemptCountBeforeRepair: 2,
    });
    if (repaired.status === 'accepted' && repaired.document && !retainsInitialFacts(repaired.document)) {
      return finalizeBudgetCompletion(retainedInitialResult(repaired.diagnostics.attemptCount, repaired.diagnostics.repairAttempted), 'repair');
    }
    return finalizeBudgetCompletion(repaired, 'repair');
  }

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: applyBudgetCompletion(retryValidation.document, 'reread').document,
    diagnostics: params.run.diagnostics({
      attemptCount: 2,
      repairAttempted: Boolean(params.semanticRepairConsumed?.()),
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
