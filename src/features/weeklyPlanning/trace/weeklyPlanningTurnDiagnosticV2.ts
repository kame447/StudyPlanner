import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import type {
  WeeklyPlanningStableV5DebugTraceEvent,
} from './weeklyPlanningStableV5DebugTrace';
import type {
  WeeklyPlanningTraceAiRequest,
  WeeklyPlanningTraceAiValidationResult,
  WeeklyPlanningTraceParserDecision,
  WeeklyPlanningTraceRelevantBusyInterval,
  WeeklyPlanningTraceRejectedOperation,
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

interface TruncationMetadata {
  applied: boolean;
  fields: string[];
  originalCounts: Record<string, number>;
}

interface TruncationTracker {
  fields: Set<string>;
  originalCounts: Record<string, number>;
}

type DiagnosticWithTruncation = WeeklyPlanningTraceTurnDiagnosticEntry & {
  diagnostics: WeeklyPlanningTraceTurnDiagnosticEntry['diagnostics'] & {
    truncation: TruncationMetadata;
  };
};

const NORMAL_LIMITS = {
  textBytes: 4_000,
  shortTextBytes: 1_000,
  conversationMessages: 8,
  requestCount: 2,
  requestMessages: 6,
  rawResponses: 2,
  validationResults: 2,
  validationErrors: 10,
  candidateOperations: 10,
  parserDecisions: 12,
  decisionOperations: 10,
  busyIntervals: 100,
  unknownBytes: 4_000,
  operationBytes: 1_500,
  stateDiffBytes: 6_000,
} as const;

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

function markField(tracker: TruncationTracker, field: string): void {
  tracker.fields.add(field);
}

function markCount(
  tracker: TruncationTracker,
  field: string,
  originalCount: number,
): void {
  tracker.fields.add(field);
  tracker.originalCounts[field] = Math.max(
    tracker.originalCounts[field] ?? 0,
    originalCount,
  );
}

function truncateUtf8Text(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  const suffix = '…[trace truncated]';
  const suffixBytes = encoder.encode(suffix).byteLength;
  const contentBudget = Math.max(0, maxBytes - suffixBytes);
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, middle)).byteLength <= contentBudget) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  let end = low;
  if (end > 0 && /[\uD800-\uDBFF]/.test(value.charAt(end - 1))) end -= 1;
  return `${value.slice(0, end)}${suffix}`;
}

function boundedText(
  value: string,
  maxBytes: number,
  tracker: TruncationTracker,
  field: string,
): string {
  const bounded = truncateUtf8Text(value, maxBytes);
  if (bounded !== value) markField(tracker, field);
  return bounded;
}

function boundedNullableText(
  value: string | null,
  maxBytes: number,
  tracker: TruncationTracker,
  field: string,
): string | null {
  return value === null ? null : boundedText(value, maxBytes, tracker, field);
}

function boundedUnknown(
  value: unknown,
  maxBytes: number,
  tracker: TruncationTracker,
  field: string,
): unknown {
  if (value === null || value === undefined) return value ?? null;
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? 'null';
  } catch {
    markField(tracker, field);
    return { traceTruncated: true, reason: 'unserializable' };
  }
  const originalBytes = new TextEncoder().encode(serialized).byteLength;
  if (originalBytes <= maxBytes) return value;
  markField(tracker, field);
  return {
    traceTruncated: true,
    originalBytes,
    jsonPreview: truncateUtf8Text(serialized, Math.max(256, maxBytes - 128)),
  };
}

function limitedArray<T>(
  values: readonly T[],
  maxItems: number,
  tracker: TruncationTracker,
  field: string,
): T[] {
  if (values.length <= maxItems) return [...values];
  markCount(tracker, field, values.length);
  return values.slice(0, maxItems);
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

function messages(
  value: unknown,
  tracker: TruncationTracker,
  field: string,
  maxItems: number,
  maxTextBytes: number,
  preferTail = false,
): Array<{ role: string; content: string }> {
  if (!Array.isArray(value)) return [];
  const parsed = value.flatMap((item) => {
    const candidate = record(item);
    const role = stringValue(candidate.role);
    const content = stringValue(candidate.content);
    return role !== null && content !== null ? [{ role, content }] : [];
  });
  let selected = parsed;
  if (parsed.length > maxItems) {
    markCount(tracker, field, parsed.length);
    selected = preferTail ? parsed.slice(-maxItems) : parsed.slice(0, maxItems);
  }
  return selected.map((message, index) => ({
    role: boundedText(message.role, 128, tracker, `${field}[${index}].role`),
    content: boundedText(
      message.content,
      maxTextBytes,
      tracker,
      `${field}[${index}].content`,
    ),
  }));
}

function aiRequests(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  tracker: TruncationTracker,
): WeeklyPlanningTraceAiRequest[] {
  const data = limitedArray(
    eventData(events, 'semantic_provider_request'),
    NORMAL_LIMITS.requestCount,
    tracker,
    'aiInterpreter.input.requests',
  );
  return data.map((item, index) => {
    const request = record(item.request);
    return {
      attempt: boundedText(
        stringValue(item.attempt) ?? 'unknown',
        256,
        tracker,
        `aiInterpreter.input.requests[${index}].attempt`,
      ),
      messages: messages(
        request.messages,
        tracker,
        `aiInterpreter.input.requests[${index}].messages`,
        NORMAL_LIMITS.requestMessages,
        1_500,
      ),
      purpose: boundedNullableText(
        stringValue(request.purpose),
        NORMAL_LIMITS.shortTextBytes,
        tracker,
        `aiInterpreter.input.requests[${index}].purpose`,
      ),
      responseFormat: boundedUnknown(
        request.responseFormat ?? null,
        1_500,
        tracker,
        `aiInterpreter.input.requests[${index}].responseFormat`,
      ),
      maxCompletionTokens: numberValue(request.maxCompletionTokens),
      requestBytes: numberValue(item.requestBytes),
    };
  });
}

function validationResults(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  tracker: TruncationTracker,
): WeeklyPlanningTraceAiValidationResult[] {
  const data = limitedArray(
    eventData(events, 'semantic_validation_result'),
    NORMAL_LIMITS.validationResults,
    tracker,
    'aiInterpreter.structuredResults',
  );
  return data.map((item, index) => {
    const rawErrors = Array.isArray(item.errors)
      ? item.errors.filter((error): error is string => typeof error === 'string')
      : [];
    const errors = limitedArray(
      rawErrors,
      NORMAL_LIMITS.validationErrors,
      tracker,
      `aiInterpreter.structuredResults[${index}].errors`,
    ).map((error, errorIndex) => boundedText(
      error,
      500,
      tracker,
      `aiInterpreter.structuredResults[${index}].errors[${errorIndex}]`,
    ));
    return {
      attempt: boundedText(
        stringValue(item.attempt) ?? 'unknown',
        256,
        tracker,
        `aiInterpreter.structuredResults[${index}].attempt`,
      ),
      accepted: item.accepted === true,
      errors,
      structuredResult: boundedUnknown(
        item.parsedDocument ?? null,
        NORMAL_LIMITS.unknownBytes,
        tracker,
        `aiInterpreter.structuredResults[${index}].structuredResult`,
      ),
    };
  });
}

function operationCandidates(
  value: unknown,
  tracker: TruncationTracker,
): unknown[] {
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
  return limitedArray(
    result,
    NORMAL_LIMITS.candidateOperations,
    tracker,
    'aiInterpreter.candidateOperations',
  ).map((candidate, index) => boundedUnknown(
    candidate,
    1_000,
    tracker,
    `aiInterpreter.candidateOperations[${index}]`,
  ));
}

function matchedTextFromCriterion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/includes\(["'](.+)["']\)/);
  return match?.[1] ?? null;
}

function parserDecisions(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  userText: string,
  tracker: TruncationTracker,
): WeeklyPlanningTraceParserDecision[] {
  const inference = latestEventData(events, 'contextual_question_inference');
  const binding = latestEventData(events, 'contextual_answer_binding_evaluated');
  const allRules = Array.isArray(inference.rules) ? inference.rules : [];
  const rules = limitedArray(
    allRules,
    NORMAL_LIMITS.parserDecisions,
    tracker,
    'parsers',
  );
  const precedingAssistantText = stringValue(inference.lastAssistantMessage);
  const selectedQuestionCode = stringValue(inference.selectedQuestionCode);
  const selectedRule = allRules
    .map(record)
    .find((rule) => stringValue(rule.code) === selectedQuestionCode);
  const contextualApplied = binding.contextualAnswerApplied === true;
  const contextualResult = binding.contextualAnswerResult ?? null;
  const decisions: WeeklyPlanningTraceParserDecision[] = rules.map((item, index) => {
    const rule = record(item);
    const matched = rule.matched === true;
    return {
      parser: 'stable_v5_contextual_question',
      inputText: boundedNullableText(
        precedingAssistantText,
        NORMAL_LIMITS.shortTextBytes,
        tracker,
        `parsers[${index}].inputText`,
      ),
      matchedText: boundedNullableText(
        matched ? matchedTextFromCriterion(rule.criterion) : null,
        500,
        tracker,
        `parsers[${index}].matchedText`,
      ),
      candidateOperation: matched
        ? boundedUnknown(
            { questionCode: stringValue(rule.code) },
            NORMAL_LIMITS.operationBytes,
            tracker,
            `parsers[${index}].candidateOperation`,
          )
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
      inputText: boundedText(
        userText,
        NORMAL_LIMITS.shortTextBytes,
        tracker,
        `parsers[${decisions.length}].inputText`,
      ),
      matchedText: boundedNullableText(
        selectedRule ? matchedTextFromCriterion(selectedRule.criterion) : null,
        500,
        tracker,
        `parsers[${decisions.length}].matchedText`,
      ),
      candidateOperation: boundedUnknown(
        contextualResult,
        NORMAL_LIMITS.operationBytes,
        tracker,
        `parsers[${decisions.length}].candidateOperation`,
      ),
      accepted: contextualApplied,
      reason: contextualApplied
        ? null
        : selectedQuestionCode === null
          ? 'no contextual question rule matched'
          : 'minimal-reply or revision binding criteria were not satisfied',
    });
  }
  if (decisions.length > NORMAL_LIMITS.parserDecisions) {
    markCount(tracker, 'parsers', decisions.length);
    return decisions.slice(0, NORMAL_LIMITS.parserDecisions);
  }
  return decisions;
}

function busyIntervals(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  tracker: TruncationTracker,
): WeeklyPlanningTraceRelevantBusyInterval[] {
  const runtime = latestEventData(events, 'runtime_scheduler_dialogue_evaluated');
  const schedulerInput = record(runtime.schedulerInput);
  const sources = Array.isArray(schedulerInput.externalSources)
    ? schedulerInput.externalSources
    : [];
  const totalCount = sources.reduce((count, sourceValue) => {
    const sourceEvents = record(sourceValue).events;
    return count + (Array.isArray(sourceEvents) ? sourceEvents.length : 0);
  }, 0);
  if (totalCount > NORMAL_LIMITS.busyIntervals) {
    markCount(tracker, 'constraintContext.relevantBusyIntervals', totalCount);
  }

  const result: WeeklyPlanningTraceRelevantBusyInterval[] = [];
  for (const sourceValue of sources) {
    const source = record(sourceValue);
    const sourceKind = stringValue(source.kind) ?? 'unknown';
    const sourceEvents = Array.isArray(source.events) ? source.events : [];
    for (const eventValue of sourceEvents) {
      if (result.length >= NORMAL_LIMITS.busyIntervals) return result;
      const event = record(eventValue);
      const start = record(event.start);
      const end = record(event.end);
      const date = stringValue(start.date);
      const startTime = stringValue(start.time);
      const endTime = stringValue(end.time);
      if (!date || !startTime || !endTime) continue;
      result.push({
        date: boundedText(date, 64, tracker, 'constraintContext.relevantBusyIntervals.date'),
        start: boundedText(startTime, 32, tracker, 'constraintContext.relevantBusyIntervals.start'),
        end: boundedText(endTime, 32, tracker, 'constraintContext.relevantBusyIntervals.end'),
        source: boundedText(sourceKind, 128, tracker, 'constraintContext.relevantBusyIntervals.source'),
      });
    }
  }
  return result;
}

function errorFromValue(
  value: unknown,
  tracker: TruncationTracker,
  field: string,
): { type: string; message: string } | null {
  const candidate = record(value);
  const nested = isRecord(candidate.error) ? candidate.error : candidate;
  const message = stringValue(nested.message);
  if (!message) return null;
  return {
    type: boundedText(
      stringValue(nested.name) ?? stringValue(nested.type) ?? 'Error',
      256,
      tracker,
      `${field}.type`,
    ),
    message: boundedText(message, NORMAL_LIMITS.shortTextBytes, tracker, `${field}.message`),
  };
}

function firstError(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  tracker: TruncationTracker,
  errorCode?: string,
): { type: string; message: string } | null {
  for (const stage of ['runtime_turn_threw', 'semantic_provider_error']) {
    for (const data of eventData(events, stage)) {
      const found = errorFromValue(data, tracker, 'diagnostics.error');
      if (found) return found;
    }
  }
  if (!errorCode) return null;
  return {
    type: boundedText(errorCode, 256, tracker, 'diagnostics.error.type'),
    message: boundedText(errorCode, NORMAL_LIMITS.shortTextBytes, tracker, 'diagnostics.error.message'),
  };
}

function firstProviderError(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  tracker: TruncationTracker,
): { type: string; message: string } | null {
  for (const data of eventData(events, 'semantic_provider_error')) {
    const found = errorFromValue(data, tracker, 'aiInterpreter.error');
    if (found) return found;
  }
  return null;
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

function rejectedOperations(params: {
  validations: WeeklyPlanningTraceAiValidationResult[];
  aiCandidates: unknown[];
  canonicalizationBranch: string | null;
  canonicalizationErrors: string[];
  tracker: TruncationTracker;
}): WeeklyPlanningTraceRejectedOperation[] {
  const rejected: WeeklyPlanningTraceRejectedOperation[] = [];
  params.validations
    .filter((result) => !result.accepted)
    .forEach((result) => {
      rejected.push({
        operation: boundedUnknown({
          source: 'ai',
          attempt: result.attempt,
          structuredResult: result.structuredResult,
        }, NORMAL_LIMITS.operationBytes, params.tracker, 'decision.rejectedOperations.operation'),
        reason: boundedText(
          result.errors.length > 0
            ? `schema validation failed: ${result.errors.join('; ')}`
            : 'schema validation rejected the AI response',
          NORMAL_LIMITS.shortTextBytes,
          params.tracker,
          'decision.rejectedOperations.reason',
        ),
      });
    });
  if (params.canonicalizationBranch === 'contextual_answer_binding') {
    params.aiCandidates.forEach((candidate) => {
      rejected.push({
        operation: boundedUnknown(
          { source: 'ai', candidate },
          NORMAL_LIMITS.operationBytes,
          params.tracker,
          'decision.rejectedOperations.operation',
        ),
        reason: 'contextual parser result took precedence over the AI candidate for this turn',
      });
    });
  }
  params.canonicalizationErrors.forEach((reason) => {
    rejected.push({
      operation: null,
      reason: boundedText(
        reason,
        NORMAL_LIMITS.shortTextBytes,
        params.tracker,
        'decision.rejectedOperations.reason',
      ),
    });
  });
  return limitedArray(
    rejected,
    NORMAL_LIMITS.decisionOperations,
    params.tracker,
    'decision.rejectedOperations',
  );
}

function metadata(tracker: TruncationTracker): TruncationMetadata {
  return {
    applied: tracker.fields.size > 0,
    fields: [...tracker.fields].sort(),
    originalCounts: { ...tracker.originalCounts },
  };
}

function compactMessages(
  values: Array<{ role: string; content: string }>,
  count: number,
  textBytes: number,
  tracker: TruncationTracker,
  field: string,
): Array<{ role: string; content: string }> {
  const selected = values.length > count ? values.slice(-count) : values;
  if (selected.length !== values.length) markCount(tracker, field, values.length);
  return selected.map((message, index) => ({
    role: boundedText(message.role, 64, tracker, `${field}[${index}].role`),
    content: boundedText(message.content, textBytes, tracker, `${field}[${index}].content`),
  }));
}

function compactDiagnostic(
  entry: DiagnosticWithTruncation,
  tracker: TruncationTracker,
  minimal = false,
): DiagnosticWithTruncation {
  const messageCount = minimal ? 2 : 4;
  const messageBytes = minimal ? 500 : 750;
  const operationCount = minimal ? 2 : 4;
  const operationBytes = minimal ? 300 : 500;
  const parserCount = minimal ? 2 : 6;
  const busyCount = minimal ? 20 : 30;

  markField(tracker, minimal ? 'diagnostics.minimalCompaction' : 'diagnostics.emergencyCompaction');
  const acceptedParsers = entry.parsers.filter((parser) => parser.accepted);
  const parserPool = [...acceptedParsers, ...entry.parsers.filter((parser) => !parser.accepted)];
  const parsers = limitedArray(parserPool, parserCount, tracker, 'parsers').map((parser, index) => ({
    ...parser,
    inputText: boundedNullableText(parser.inputText, 500, tracker, `parsers[${index}].inputText`),
    matchedText: boundedNullableText(parser.matchedText, 300, tracker, `parsers[${index}].matchedText`),
    candidateOperation: boundedUnknown(
      parser.candidateOperation,
      operationBytes,
      tracker,
      `parsers[${index}].candidateOperation`,
    ),
    reason: boundedNullableText(parser.reason, 500, tracker, `parsers[${index}].reason`),
  }));

  const compacted: DiagnosticWithTruncation = {
    ...entry,
    userInput: {
      text: boundedText(entry.userInput.text, minimal ? 1_000 : 2_000, tracker, 'userInput.text'),
    },
    aiInterpreter: {
      ...entry.aiInterpreter,
      input: {
        userText: boundedText(
          entry.aiInterpreter.input.userText,
          minimal ? 1_000 : 2_000,
          tracker,
          'aiInterpreter.input.userText',
        ),
        conversationContext: compactMessages(
          entry.aiInterpreter.input.conversationContext,
          messageCount,
          messageBytes,
          tracker,
          'aiInterpreter.input.conversationContext',
        ),
        planningStateSummary: minimal
          ? null
          : boundedUnknown(
              entry.aiInterpreter.input.planningStateSummary,
              1_000,
              tracker,
              'aiInterpreter.input.planningStateSummary',
            ),
        requests: limitedArray(
          entry.aiInterpreter.input.requests,
          minimal ? 1 : 2,
          tracker,
          'aiInterpreter.input.requests',
        ).map((request, index) => ({
          ...request,
          messages: compactMessages(
            request.messages,
            minimal ? 2 : 3,
            messageBytes,
            tracker,
            `aiInterpreter.input.requests[${index}].messages`,
          ),
          responseFormat: minimal
            ? null
            : boundedUnknown(
                request.responseFormat,
                500,
                tracker,
                `aiInterpreter.input.requests[${index}].responseFormat`,
              ),
        })),
      },
      rawResponses: limitedArray(
        entry.aiInterpreter.rawResponses,
        minimal ? 1 : 2,
        tracker,
        'aiInterpreter.rawResponses',
      ).map((response, index) => ({
        ...response,
        text: boundedText(
          response.text,
          minimal ? 1_000 : 1_500,
          tracker,
          `aiInterpreter.rawResponses[${index}].text`,
        ),
      })),
      structuredResults: limitedArray(
        entry.aiInterpreter.structuredResults,
        minimal ? 1 : 2,
        tracker,
        'aiInterpreter.structuredResults',
      ).map((result, index) => ({
        ...result,
        errors: limitedArray(result.errors, minimal ? 3 : 5, tracker,
          `aiInterpreter.structuredResults[${index}].errors`)
          .map((error, errorIndex) => boundedText(
            error,
            300,
            tracker,
            `aiInterpreter.structuredResults[${index}].errors[${errorIndex}]`,
          )),
        structuredResult: minimal
          ? null
          : boundedUnknown(
              result.structuredResult,
              1_500,
              tracker,
              `aiInterpreter.structuredResults[${index}].structuredResult`,
            ),
      })),
      candidateOperations: limitedArray(
        entry.aiInterpreter.candidateOperations,
        operationCount,
        tracker,
        'aiInterpreter.candidateOperations',
      ).map((operation, index) => boundedUnknown(
        operation,
        operationBytes,
        tracker,
        `aiInterpreter.candidateOperations[${index}]`,
      )),
      error: entry.aiInterpreter.error
        ? {
            type: boundedText(entry.aiInterpreter.error.type, 128, tracker, 'aiInterpreter.error.type'),
            message: boundedText(entry.aiInterpreter.error.message, 500, tracker, 'aiInterpreter.error.message'),
          }
        : null,
    },
    parsers,
    decision: {
      ...entry.decision,
      acceptedOperations: limitedArray(
        entry.decision.acceptedOperations,
        operationCount,
        tracker,
        'decision.acceptedOperations',
      ).map((operation, index) => boundedUnknown(
        operation,
        operationBytes,
        tracker,
        `decision.acceptedOperations[${index}]`,
      )),
      rejectedOperations: limitedArray(
        entry.decision.rejectedOperations,
        operationCount,
        tracker,
        'decision.rejectedOperations',
      ).map((operation, index) => ({
        operation: boundedUnknown(
          operation.operation,
          operationBytes,
          tracker,
          `decision.rejectedOperations[${index}].operation`,
        ),
        reason: boundedText(
          operation.reason,
          500,
          tracker,
          `decision.rejectedOperations[${index}].reason`,
        ),
      })),
      finalOperations: limitedArray(
        entry.decision.finalOperations,
        operationCount,
        tracker,
        'decision.finalOperations',
      ).map((operation, index) => boundedUnknown(
        operation,
        operationBytes,
        tracker,
        `decision.finalOperations[${index}]`,
      )),
      stateDiff: boundedUnknown(
        entry.decision.stateDiff,
        minimal ? 1_500 : 2_000,
        tracker,
        'decision.stateDiff',
      ),
    },
    constraintContext: {
      ...entry.constraintContext,
      relevantBusyIntervals: limitedArray(
        entry.constraintContext.relevantBusyIntervals,
        busyCount,
        tracker,
        'constraintContext.relevantBusyIntervals',
      ),
    },
    assistantOutput: {
      ...entry.assistantOutput,
      text: boundedNullableText(
        entry.assistantOutput.text,
        minimal ? 1_000 : 2_000,
        tracker,
        'assistantOutput.text',
      ),
    },
    diagnostics: {
      ...entry.diagnostics,
      error: entry.diagnostics.error
        ? {
            type: boundedText(entry.diagnostics.error.type, 128, tracker, 'diagnostics.error.type'),
            message: boundedText(entry.diagnostics.error.message, 500, tracker, 'diagnostics.error.message'),
          }
        : null,
      truncation: metadata(tracker),
    },
  };
  compacted.diagnostics.truncation = metadata(tracker);
  return compacted;
}

function fitDiagnosticToTarget(
  entry: DiagnosticWithTruncation,
  tracker: TruncationTracker,
): DiagnosticWithTruncation {
  entry.diagnostics.truncation = metadata(tracker);
  if (measureWeeklyPlanningTraceJsonBytes(entry)
    <= WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes) {
    return entry;
  }

  const compacted = compactDiagnostic(entry, tracker);
  if (measureWeeklyPlanningTraceJsonBytes(compacted)
    <= WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes) {
    return compacted;
  }

  const minimal = compactDiagnostic(compacted, tracker, true);
  if (measureWeeklyPlanningTraceJsonBytes(minimal)
    <= WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes) {
    return minimal;
  }

  markField(tracker, 'diagnostics.lastResortCompaction');
  const lastResort: DiagnosticWithTruncation = {
    ...minimal,
    userInput: { text: boundedText(minimal.userInput.text, 500, tracker, 'userInput.text') },
    aiInterpreter: {
      ...minimal.aiInterpreter,
      input: {
        userText: boundedText(minimal.aiInterpreter.input.userText, 500, tracker,
          'aiInterpreter.input.userText'),
        conversationContext: [],
        planningStateSummary: null,
        requests: [],
      },
      rawResponses: minimal.aiInterpreter.rawResponses.slice(0, 1).map((response) => ({
        ...response,
        text: boundedText(response.text, 500, tracker, 'aiInterpreter.rawResponses[0].text'),
      })),
      structuredResults: [],
      candidateOperations: [],
    },
    parsers: minimal.parsers.filter((parser) => parser.accepted).slice(0, 1),
    decision: {
      ...minimal.decision,
      acceptedOperations: [],
      rejectedOperations: [],
      finalOperations: [],
      stateDiff: boundedUnknown(minimal.decision.stateDiff, 1_000, tracker, 'decision.stateDiff'),
    },
    constraintContext: {
      ...minimal.constraintContext,
      relevantBusyIntervals: minimal.constraintContext.relevantBusyIntervals.slice(0, 10),
    },
    assistantOutput: {
      ...minimal.assistantOutput,
      text: boundedNullableText(minimal.assistantOutput.text, 500, tracker, 'assistantOutput.text'),
    },
    diagnostics: {
      ...minimal.diagnostics,
      truncation: metadata(tracker),
    },
  };
  lastResort.diagnostics.truncation = metadata(tracker);
  return lastResort;
}

export function createWeeklyPlanningTurnDiagnosticV2(
  input: CreateTurnDiagnosticInput,
): WeeklyPlanningTraceTurnDiagnosticEntry {
  const tracker: TruncationTracker = { fields: new Set(), originalCounts: {} };
  const events = input.debugTraceEvents ?? [];
  const configuration = latestEventData(events, 'runtime_configuration_evaluated');
  const prepared = latestEventData(events, 'semantic_normalizer_prepared');
  const pipelineInput = latestEventData(events, 'semantic_pipeline_input');
  const runtimeInput = latestEventData(events, 'runtime_turn_input');
  const canonicalization = latestEventData(events, 'semantic_canonicalization_evaluated');
  const canonicalResult = record(canonicalization.result);
  const branch = latestEventData(events, 'runtime_branch_selected');
  const pipelineDecision = latestEventData(events, 'semantic_pipeline_decision');
  const canonicalizationBranch = stringValue(canonicalization.branch);
  const rawFinalOperations = Array.isArray(canonicalization.adoptedOperations)
    ? canonicalization.adoptedOperations
    : canonicalization.adoptedOperations == null
      ? []
      : [canonicalization.adoptedOperations];
  const finalOperations = limitedArray(
    rawFinalOperations,
    NORMAL_LIMITS.decisionOperations,
    tracker,
    'decision.finalOperations',
  ).map((operation, index) => boundedUnknown(
    operation,
    NORMAL_LIMITS.operationBytes,
    tracker,
    `decision.finalOperations[${index}]`,
  ));
  const canonicalizationErrors = Array.isArray(canonicalization.rejectionErrors)
    ? canonicalization.rejectionErrors.filter((item): item is string => typeof item === 'string')
    : [];
  const validations = validationResults(events, tracker);
  const latestAccepted = [...validations].reverse().find((item) => item.accepted);
  const aiCandidates = operationCandidates(latestAccepted?.structuredResult, tracker);
  const recentConversation = messages(
    pipelineInput.recentConversation,
    tracker,
    'aiInterpreter.input.conversationContext',
    NORMAL_LIMITS.conversationMessages,
    1_500,
    true,
  );
  const counts = record(runtimeInput.inputCounts);
  const rawResponseData = limitedArray(
    eventData(events, 'semantic_provider_response'),
    NORMAL_LIMITS.rawResponses,
    tracker,
    'aiInterpreter.rawResponses',
  );
  const rawResponses = rawResponseData.map((data, index) => ({
    attempt: boundedText(
      stringValue(data.attempt) ?? 'unknown',
      256,
      tracker,
      `aiInterpreter.rawResponses[${index}].attempt`,
    ),
    text: boundedText(
      stringValue(data.rawResponse) ?? '',
      NORMAL_LIMITS.textBytes,
      tracker,
      `aiInterpreter.rawResponses[${index}].text`,
    ),
  }));
  const status = stringValue(canonicalResult.status)
    ?? stringValue(pipelineDecision.selectedStatus)
    ?? stringValue(branch.branch)
    ?? input.outcome;
  const error = firstError(events, tracker, input.errorCode);
  const acceptedSource = canonicalizationBranch === 'contextual_answer_binding'
    ? 'parser'
    : 'ai';
  const rejected = rejectedOperations({
    validations,
    aiCandidates,
    canonicalizationBranch,
    canonicalizationErrors,
    tracker,
  });

  const entry: DiagnosticWithTruncation = {
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
    userInput: {
      text: boundedText(input.userText, NORMAL_LIMITS.textBytes, tracker, 'userInput.text'),
    },
    aiInterpreter: {
      provider: boundedNullableText(
        stringValue(configuration.provider),
        256,
        tracker,
        'aiInterpreter.provider',
      ),
      model: boundedNullableText(
        stringValue(configuration.model),
        256,
        tracker,
        'aiInterpreter.model',
      ),
      promptVersion: boundedNullableText(
        stringValue(prepared.normalizerVersion),
        256,
        tracker,
        'aiInterpreter.promptVersion',
      ),
      input: {
        userText: boundedText(
          input.userText,
          NORMAL_LIMITS.textBytes,
          tracker,
          'aiInterpreter.input.userText',
        ),
        conversationContext: recentConversation,
        planningStateSummary: boundedUnknown(
          pipelineInput.publicStateSummary ?? null,
          3_000,
          tracker,
          'aiInterpreter.input.planningStateSummary',
        ),
        requests: aiRequests(events, tracker),
      },
      rawResponses,
      structuredResults: validations,
      candidateOperations: aiCandidates,
      error: firstProviderError(events, tracker),
    },
    parsers: parserDecisions(events, input.userText, tracker),
    decision: {
      status: boundedText(status, 500, tracker, 'decision.status'),
      acceptedOperations: finalOperations.map((operation, index) => boundedUnknown({
        source: acceptedSource,
        operation,
      }, NORMAL_LIMITS.operationBytes, tracker, `decision.acceptedOperations[${index}]`)),
      rejectedOperations: rejected,
      finalOperations,
      precedence: boundedNullableText(
        canonicalizationBranch,
        500,
        tracker,
        'decision.precedence',
      ),
      reason: boundedNullableText(
        stringValue(pipelineDecision.basis) ?? stringValue(branch.branch),
        NORMAL_LIMITS.shortTextBytes,
        tracker,
        'decision.reason',
      ),
      stateDiff: boundedUnknown(
        canonicalization.adoptedOperations ?? null,
        NORMAL_LIMITS.stateDiffBytes,
        tracker,
        'decision.stateDiff',
      ),
    },
    constraintContext: {
      existingPlanCount: numberValue(counts.existingPlanCount) ?? 0,
      scheduleTemplateCount: numberValue(counts.scheduleTemplateCount) ?? 0,
      relevantBusyIntervals: busyIntervals(events, tracker),
    },
    assistantOutput: {
      text: boundedNullableText(
        input.assistantMessage ?? null,
        NORMAL_LIMITS.textBytes,
        tracker,
        'assistantOutput.text',
      ),
      responseSource: responseSource(input.outcome),
    },
    diagnostics: {
      durationMs: durationMs(events),
      fallback: input.outcome.includes('fallback')
        ? boundedText(input.outcome, 500, tracker, 'diagnostics.fallback')
        : null,
      error,
      outcome: boundedText(input.outcome, 500, tracker, 'diagnostics.outcome'),
      previewCount: input.previewCount,
      stale: input.outcome === 'discarded_stale'
        || input.errorCode === 'stale_async_result_discarded',
      truncation: metadata(tracker),
    },
  };

  return fitDiagnosticToTarget(entry, tracker);
}
