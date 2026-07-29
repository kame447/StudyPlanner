import type {
  WeeklyPlanningStableV5DebugTraceEvent,
} from './weeklyPlanningStableV5DebugTrace';
import type {
  WeeklyPlanningTraceAiRequest,
  WeeklyPlanningTraceAiValidationResult,
  WeeklyPlanningTraceParserDecision,
  WeeklyPlanningTraceRelevantBusyInterval,
  WeeklyPlanningTraceResponseSource,
  WeeklyPlanningTraceTurnDiagnosticEntry,
} from './weeklyPlanningTraceTypes';

interface CreateTurnDiagnosticInput {
  id: string;
  sessionId: string;
  logicalConversationId: string;
  sequence: number;
  turnIndex: number;
  requestId: string;
  occurredAt: string;
  observedAt: string;
  expireAt: string;
  userText: string;
  assistantMessage?: string;
  outcome: string;
  previewCount: number;
  errorCode?: string;
  debugTraceEvents?: readonly WeeklyPlanningStableV5DebugTraceEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function eventData(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  stage: string,
): Record<string, unknown>[] {
  return events
    .filter((event) => event.stage === stage)
    .map((event) => record(event.data));
}

function latestEventData(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  stage: string,
): Record<string, unknown> {
  return eventData(events, stage).at(-1) ?? {};
}

function messages(value: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const candidate = record(item);
    const role = stringValue(candidate.role);
    const content = stringValue(candidate.content);
    return role !== null && content !== null ? [{ role, content }] : [];
  });
}

function aiRequests(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
): WeeklyPlanningTraceAiRequest[] {
  return eventData(events, 'semantic_provider_request').map((data) => {
    const request = record(data.request);
    return {
      attempt: stringValue(data.attempt) ?? 'unknown',
      messages: messages(request.messages),
      purpose: stringValue(request.purpose),
      responseFormat: request.responseFormat ?? null,
      maxCompletionTokens: numberValue(request.maxCompletionTokens),
      requestBytes: numberValue(data.requestBytes),
    };
  });
}

function validationResults(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
): WeeklyPlanningTraceAiValidationResult[] {
  return eventData(events, 'semantic_validation_result').map((data) => ({
    attempt: stringValue(data.attempt) ?? 'unknown',
    accepted: data.accepted === true,
    errors: Array.isArray(data.errors)
      ? data.errors.filter((item): item is string => typeof item === 'string')
      : [],
    structuredResult: data.parsedDocument ?? null,
  }));
}

function operationCandidates(value: unknown): unknown[] {
  const document = record(value);
  const result: unknown[] = [];
  if (document.planningIntent !== undefined) {
    result.push({ kind: 'planning_intent', value: document.planningIntent });
  }
  if (document.planningWindow !== null && document.planningWindow !== undefined) {
    result.push({ kind: 'planning_window', value: document.planningWindow });
  }
  const groups = [
    ['task', document.tasks],
    ['relation', document.relations],
    ['availability', document.availabilityDeclarations],
    ['constraint_source_request', document.constraintSourceRequests],
    ['uncertainty', document.uncertainties],
    ['correction', document.corrections],
    ['decision', document.decisions],
  ] as const;
  groups.forEach(([kind, values]) => {
    if (!Array.isArray(values)) return;
    values.forEach((item) => result.push({ kind, value: item }));
  });
  return result;
}

function matchedTextFromCriterion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/includes\(["'](.+)["']\)/);
  return match?.[1] ?? null;
}

function parserDecisions(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
): WeeklyPlanningTraceParserDecision[] {
  const inference = latestEventData(events, 'contextual_question_inference');
  const binding = latestEventData(events, 'contextual_answer_binding_evaluated');
  const rules = Array.isArray(inference.rules) ? inference.rules : [];
  const inputText = stringValue(inference.lastAssistantMessage);
  const selectedQuestionCode = stringValue(inference.selectedQuestionCode);
  const selectedRule = rules
    .map(record)
    .find((rule) => stringValue(rule.code) === selectedQuestionCode);
  const contextualApplied = binding.contextualAnswerApplied === true;
  const contextualResult = binding.contextualAnswerResult ?? null;
  const decisions: WeeklyPlanningTraceParserDecision[] = rules.map((item) => {
    const rule = record(item);
    const matched = rule.matched === true;
    return {
      parser: 'stable_v5_contextual_question',
      inputText,
      matchedText: matched ? matchedTextFromCriterion(rule.criterion) : null,
      candidateOperation: matched
        ? { questionCode: stringValue(rule.code) }
        : null,
      accepted: matched && stringValue(rule.code) === selectedQuestionCode,
      reason: matched
        ? stringValue(rule.code) === selectedQuestionCode
          ? null
          : 'another matching contextual rule took precedence'
        : 'configured substring was not present in the preceding assistant message',
    };
  });
  if (selectedQuestionCode !== null || Object.keys(binding).length > 0) {
    decisions.push({
      parser: 'stable_v5_contextual_answer_binding',
      inputText: stringValue(binding.observations && record(binding.observations).userText)
        ?? null,
      matchedText: selectedRule ? matchedTextFromCriterion(selectedRule.criterion) : null,
      candidateOperation: contextualResult,
      accepted: contextualApplied,
      reason: contextualApplied
        ? null
        : selectedQuestionCode === null
          ? 'no contextual question rule matched'
          : 'minimal-reply or revision binding criteria were not satisfied',
    });
  }
  return decisions;
}

function busyIntervals(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
): WeeklyPlanningTraceRelevantBusyInterval[] {
  const runtime = latestEventData(events, 'runtime_scheduler_dialogue_evaluated');
  const schedulerInput = record(runtime.schedulerInput);
  const sources = Array.isArray(schedulerInput.externalSources)
    ? schedulerInput.externalSources
    : [];
  return sources.flatMap((sourceValue) => {
    const source = record(sourceValue);
    const sourceKind = stringValue(source.kind) ?? 'unknown';
    const sourceEvents = Array.isArray(source.events) ? source.events : [];
    return sourceEvents.flatMap((eventValue) => {
      const event = record(eventValue);
      const start = record(event.start);
      const end = record(event.end);
      const date = stringValue(start.date);
      const startTime = stringValue(start.time);
      const endTime = stringValue(end.time);
      if (!date || !startTime || !endTime) return [];
      return [{ date, start: startTime, end: endTime, source: sourceKind }];
    });
  });
}

function errorFromValue(value: unknown): { type: string; message: string } | null {
  const candidate = record(value);
  const nested = isRecord(candidate.error) ? candidate.error : candidate;
  const message = stringValue(nested.message);
  if (!message) return null;
  return {
    type: stringValue(nested.name) ?? stringValue(nested.type) ?? 'Error',
    message,
  };
}

function firstError(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  errorCode?: string,
): { type: string; message: string } | null {
  for (const stage of ['runtime_turn_threw', 'semantic_provider_error']) {
    for (const data of eventData(events, stage)) {
      const found = errorFromValue(data);
      if (found) return found;
    }
  }
  if (!errorCode) return null;
  return { type: errorCode, message: errorCode };
}

function durationMs(events: readonly WeeklyPlanningStableV5DebugTraceEvent[]): number | null {
  const times = events
    .map((event) => Date.parse(event.occurredAt))
    .filter((value) => Number.isFinite(value));
  if (times.length < 2) {
    const decision = latestEventData(events, 'semantic_normalizer_decision');
    return numberValue(record(decision.diagnostics).latencyMs);
  }
  return Math.max(...times) - Math.min(...times);
}

function responseSource(outcome: string): WeeklyPlanningTraceResponseSource {
  return outcome.includes('fallback') ? 'deterministic_fallback' : 'ai';
}

export function createWeeklyPlanningTurnDiagnosticV2(
  input: CreateTurnDiagnosticInput,
): WeeklyPlanningTraceTurnDiagnosticEntry {
  const events = input.debugTraceEvents ?? [];
  const configuration = latestEventData(events, 'runtime_configuration_evaluated');
  const prepared = latestEventData(events, 'semantic_normalizer_prepared');
  const pipelineInput = latestEventData(events, 'semantic_pipeline_input');
  const runtimeInput = latestEventData(events, 'runtime_turn_input');
  const canonicalization = latestEventData(events, 'semantic_canonicalization_evaluated');
  const canonicalResult = record(canonicalization.result);
  const branch = latestEventData(events, 'runtime_branch_selected');
  const pipelineDecision = latestEventData(events, 'semantic_pipeline_decision');
  const acceptedOperations = Array.isArray(canonicalization.adoptedOperations)
    ? canonicalization.adoptedOperations
    : canonicalization.adoptedOperations == null
      ? []
      : [canonicalization.adoptedOperations];
  const rejectionErrors = Array.isArray(canonicalization.rejectionErrors)
    ? canonicalization.rejectionErrors.filter((item): item is string => typeof item === 'string')
    : [];
  const validations = validationResults(events);
  const latestAccepted = [...validations].reverse().find((item) => item.accepted);
  const recentConversation = Array.isArray(pipelineInput.recentConversation)
    ? messages(pipelineInput.recentConversation)
    : [];
  const counts = record(runtimeInput.inputCounts);
  const providerErrors = eventData(events, 'semantic_provider_error');
  const rawResponses = eventData(events, 'semantic_provider_response').map((data) => ({
    attempt: stringValue(data.attempt) ?? 'unknown',
    text: stringValue(data.rawResponse) ?? '',
  }));
  const status = stringValue(canonicalResult.status)
    ?? stringValue(pipelineDecision.selectedStatus)
    ?? stringValue(branch.branch)
    ?? input.outcome;
  const error = firstError(events, input.errorCode);

  return {
    id: input.id,
    sessionId: input.sessionId,
    logicalConversationId: input.logicalConversationId,
    sequence: input.sequence,
    requestId: input.requestId,
    occurredAt: input.occurredAt,
    observedAt: input.observedAt,
    schemaVersion: 2,
    expireAt: input.expireAt,
    kind: 'turn_diagnostic',
    traceSchema: 'weekly-planning-turn-diagnostic-v2',
    turnIndex: input.turnIndex,
    userInput: { text: input.userText },
    aiInterpreter: {
      provider: stringValue(configuration.provider),
      model: stringValue(configuration.model),
      promptVersion: stringValue(prepared.normalizerVersion),
      input: {
        userText: input.userText,
        conversationContext: recentConversation,
        planningStateSummary: pipelineInput.publicStateSummary ?? null,
        requests: aiRequests(events),
      },
      rawResponses,
      structuredResults: validations,
      candidateOperations: operationCandidates(latestAccepted?.structuredResult),
      error: providerErrors.map(errorFromValue).find((value) => value !== null) ?? null,
    },
    parsers: parserDecisions(events),
    decision: {
      status,
      acceptedOperations,
      rejectedOperations: rejectionErrors.map((reason) => ({ operation: null, reason })),
      finalOperations: acceptedOperations,
      precedence: stringValue(canonicalization.branch),
      reason: stringValue(pipelineDecision.basis) ?? stringValue(branch.branch),
      stateDiff: canonicalization.adoptedOperations ?? null,
    },
    constraintContext: {
      existingPlanCount: numberValue(counts.existingPlanCount) ?? 0,
      scheduleTemplateCount: numberValue(counts.scheduleTemplateCount) ?? 0,
      relevantBusyIntervals: busyIntervals(events),
    },
    assistantOutput: {
      text: input.assistantMessage ?? null,
      responseSource: responseSource(input.outcome),
    },
    diagnostics: {
      durationMs: durationMs(events),
      fallback: input.outcome.includes('fallback') ? input.outcome : null,
      error,
      outcome: input.outcome,
      previewCount: input.previewCount,
      stale: input.outcome === 'discarded_stale'
        || input.errorCode === 'stale_async_result_discarded',
    },
  };
}
