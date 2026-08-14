import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import type {
  WeeklyPlanningStableV5DebugTraceEvent,
} from './weeklyPlanningStableV5DebugTrace';
import type {
  WeeklyPlanningTraceAiRawResponse,
  WeeklyPlanningTraceAiRequest,
  WeeklyPlanningTraceAiValidationResult,
  WeeklyPlanningTraceParserDecision,
  WeeklyPlanningTraceRelevantBusyInterval,
  WeeklyPlanningTraceRejectedOperation,
  WeeklyPlanningTraceResponseSource,
  WeeklyPlanningTraceSchedulerIssueSummary,
  WeeklyPlanningTraceSchedulerSourceSummary,
  WeeklyPlanningTraceSchedulerSummary,
  WeeklyPlanningTraceTruncationMetadata,
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

interface TruncationTracker {
  fields: Set<string>;
  originalCounts: Record<string, number>;
}

type DiagnosticWithTruncation = WeeklyPlanningTraceTurnDiagnosticEntry & {
  diagnostics: WeeklyPlanningTraceTurnDiagnosticEntry['diagnostics'] & {
    truncation: WeeklyPlanningTraceTruncationMetadata;
  };
};

const NORMAL_LIMITS = {
  textBytes: 4_000,
  shortTextBytes: 1_000,
  conversationMessages: 8,
  requestCount: 3,
  requestMessages: 6,
  rawResponses: 3,
  validationResults: 3,
  validationErrors: 10,
  candidateOperations: 10,
  parserDecisions: 12,
  decisionOperations: 10,
  busyIntervals: 100,
  schedulerIssues: 30,
  schedulerSources: 10,
  previewCandidates: 20,
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

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function byteLength(value: string): number {
  return utf8(value).byteLength;
}

function prefix(value: string, maxBytes: number): string {
  return new TextDecoder().decode(utf8(value).slice(0, Math.max(0, maxBytes)));
}

function suffix(value: string, maxBytes: number): string {
  const bytes = utf8(value);
  return new TextDecoder().decode(bytes.slice(Math.max(0, bytes.byteLength - maxBytes)));
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (const item of utf8(value)) {
    hash ^= item;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
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
  if (byteLength(value) <= maxBytes) return value;
  const marker = '…[trace truncated]';
  return `${prefix(value, Math.max(0, maxBytes - byteLength(marker)))}${marker}`;
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
  const originalBytes = byteLength(serialized);
  if (originalBytes <= maxBytes) return value;
  markField(tracker, field);
  const markerBudget = Math.min(256, Math.max(64, Math.floor(maxBytes * 0.15)));
  const contentBudget = Math.max(128, maxBytes - markerBudget);
  return {
    traceTruncated: true,
    originalBytes,
    jsonHead: prefix(serialized, Math.floor(contentBudget * 0.65)),
    jsonTail: suffix(serialized, Math.floor(contentBudget * 0.35)),
    checksum: fnv1a32(serialized),
  };
}

function limitedArray<T>(
  values: readonly T[],
  maxItems: number,
  tracker: TruncationTracker,
  field: string,
  preferTail = false,
): T[] {
  if (values.length <= maxItems) return [...values];
  markCount(tracker, field, values.length);
  return preferTail ? values.slice(-maxItems) : values.slice(0, maxItems);
}

function eventData(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  stage: string,
): Record<string, unknown>[] {
  return events.filter((event) => event.stage === stage).map((event) => record(event.data));
}

function latestEventData(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  stage: string,
): Record<string, unknown> {
  const values = eventData(events, stage);
  return values[values.length - 1] ?? {};
}

function hasEvent(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  stage: string,
): boolean {
  return events.some((event) => event.stage === stage);
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
  return limitedArray(parsed, maxItems, tracker, field, preferTail).map((message, index) => ({
    role: boundedText(message.role, 128, tracker, `${field}[${index}].role`),
    content: boundedText(message.content, maxTextBytes, tracker, `${field}[${index}].content`),
  }));
}

function aiRequests(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  tracker: TruncationTracker,
): WeeklyPlanningTraceAiRequest[] {
  return limitedArray(
    eventData(events, 'semantic_provider_request'),
    NORMAL_LIMITS.requestCount,
    tracker,
    'aiInterpreter.input.requests',
  ).map((item, index) => {
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

function rawResponse(
  item: Record<string, unknown>,
  index: number,
  tracker: TruncationTracker,
  maxBytes: number = NORMAL_LIMITS.textBytes,
): WeeklyPlanningTraceAiRawResponse {
  const source = stringValue(item.rawResponse) ?? '';
  const declaredOriginalBytes = numberValue(item.rawResponseOriginalBytes);
  const originalBytes = declaredOriginalBytes ?? byteLength(source);
  const declaredTruncated = item.rawResponseTruncated === true;
  const checksum = stringValue(item.rawResponseChecksum) ?? fnv1a32(source);
  if (byteLength(source) <= maxBytes) {
    if (declaredTruncated) markField(tracker, `aiInterpreter.rawResponses[${index}].text`);
    return {
      attempt: boundedText(
        stringValue(item.attempt) ?? 'unknown',
        256,
        tracker,
        `aiInterpreter.rawResponses[${index}].attempt`,
      ),
      text: source,
      originalBytes,
      truncated: declaredTruncated,
      checksum,
    };
  }
  markField(tracker, `aiInterpreter.rawResponses[${index}].text`);
  const metadata = `[trace head-tail originalBytes=${originalBytes} checksum=${checksum}]`;
  const contentBudget = Math.max(400, maxBytes - byteLength(metadata) - 2);
  return {
    attempt: boundedText(
      stringValue(item.attempt) ?? 'unknown',
      256,
      tracker,
      `aiInterpreter.rawResponses[${index}].attempt`,
    ),
    text: `${prefix(source, Math.floor(contentBudget * 0.65))}\n${metadata}\n${suffix(source, Math.floor(contentBudget * 0.35))}`,
    originalBytes,
    truncated: true,
    checksum,
  };
}

function rawResponses(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  tracker: TruncationTracker,
): WeeklyPlanningTraceAiRawResponse[] {
  return limitedArray(
    eventData(events, 'semantic_provider_response'),
    NORMAL_LIMITS.rawResponses,
    tracker,
    'aiInterpreter.rawResponses',
  ).map((item, index) => rawResponse(item, index, tracker));
}

function validationResults(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  tracker: TruncationTracker,
): WeeklyPlanningTraceAiValidationResult[] {
  return limitedArray(
    eventData(events, 'semantic_validation_result'),
    NORMAL_LIMITS.validationResults,
    tracker,
    'aiInterpreter.structuredResults',
  ).map((item, index) => {
    const allErrors = Array.isArray(item.errors)
      ? item.errors.filter((error): error is string => typeof error === 'string')
      : [];
    return {
      attempt: boundedText(
        stringValue(item.attempt) ?? 'unknown',
        256,
        tracker,
        `aiInterpreter.structuredResults[${index}].attempt`,
      ),
      accepted: item.accepted === true,
      errors: limitedArray(
        allErrors,
        NORMAL_LIMITS.validationErrors,
        tracker,
        `aiInterpreter.structuredResults[${index}].errors`,
      ).map((error, errorIndex) => boundedText(
        error,
        500,
        tracker,
        `aiInterpreter.structuredResults[${index}].errors[${errorIndex}]`,
      )),
      structuredResult: boundedUnknown(
        item.parsedDocument ?? null,
        NORMAL_LIMITS.unknownBytes,
        tracker,
        `aiInterpreter.structuredResults[${index}].structuredResult`,
      ),
    };
  });
}

function operationCandidates(value: unknown, tracker: TruncationTracker): unknown[] {
  const document = record(value);
  const candidates: unknown[] = [];
  if (document.planningIntent !== undefined) {
    candidates.push({ kind: 'planning_intent', value: document.planningIntent });
  }
  if (document.planningWindow !== null && document.planningWindow !== undefined) {
    candidates.push({ kind: 'planning_window', value: document.planningWindow });
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
    if (Array.isArray(values)) values.forEach((item) => candidates.push({ kind, value: item }));
  });
  return limitedArray(
    candidates,
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
  return value.match(/includes\(["'](.+)["']\)/)?.[1] ?? null;
}

function parserDecisions(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  userText: string,
  tracker: TruncationTracker,
): WeeklyPlanningTraceParserDecision[] {
  const inference = latestEventData(events, 'contextual_question_inference');
  const binding = latestEventData(events, 'contextual_answer_binding_evaluated');
  const allRules = Array.isArray(inference.rules) ? inference.rules : [];
  const selectedQuestionCode = stringValue(inference.selectedQuestionCode);
  const selectedRule = allRules.map(record)
    .find((rule) => stringValue(rule.code) === selectedQuestionCode);
  const decisions = limitedArray(
    allRules,
    NORMAL_LIMITS.parserDecisions,
    tracker,
    'parsers',
  ).map((item, index): WeeklyPlanningTraceParserDecision => {
    const rule = record(item);
    const matched = rule.matched === true;
    const selected = matched && stringValue(rule.code) === selectedQuestionCode;
    return {
      parser: 'stable_v5_contextual_question',
      inputText: boundedNullableText(
        stringValue(inference.lastAssistantMessage),
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
      accepted: selected,
      reason: matched
        ? selected ? null : 'another matching contextual rule took precedence'
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
        binding.contextualAnswerResult ?? null,
        NORMAL_LIMITS.operationBytes,
        tracker,
        `parsers[${decisions.length}].candidateOperation`,
      ),
      accepted: binding.contextualAnswerApplied === true,
      reason: binding.contextualAnswerApplied === true
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

function schedulerSourceValues(runtime: Record<string, unknown>): unknown[] {
  if (Array.isArray(runtime.externalSources)) return runtime.externalSources;
  const schedulerInput = record(runtime.schedulerInput);
  return Array.isArray(schedulerInput.externalSources) ? schedulerInput.externalSources : [];
}

function busyIntervals(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  tracker: TruncationTracker,
): WeeklyPlanningTraceRelevantBusyInterval[] {
  const runtime = latestEventData(events, 'runtime_scheduler_dialogue_evaluated');
  const sources = schedulerSourceValues(runtime);
  const totalCount = sources.reduce<number>((count, sourceValue) => {
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

function sourceSummaries(
  runtime: Record<string, unknown>,
  tracker: TruncationTracker,
): WeeklyPlanningTraceSchedulerSourceSummary[] {
  return limitedArray(
    schedulerSourceValues(runtime),
    NORMAL_LIMITS.schedulerSources,
    tracker,
    'constraintContext.scheduler.externalSources',
  ).map((sourceValue) => {
    const source = record(sourceValue);
    const events = Array.isArray(source.events) ? source.events : [];
    return {
      kind: stringValue(source.kind) ?? 'unknown',
      status: stringValue(source.status) ?? 'unknown',
      failureKind: stringValue(source.failureKind),
      eventCount: numberValue(source.eventCount) ?? events.length,
    };
  });
}

function issueSummaries(
  runtime: Record<string, unknown>,
  tracker: TruncationTracker,
): WeeklyPlanningTraceSchedulerIssueSummary[] {
  const compilation = record(runtime.compilation);
  const issues = Array.isArray(compilation.issues) ? compilation.issues : [];
  return limitedArray(
    issues,
    NORMAL_LIMITS.schedulerIssues,
    tracker,
    'constraintContext.scheduler.issues',
  ).map((issueValue) => {
    const issue = record(issueValue);
    return {
      code: stringValue(issue.code),
      domain: stringValue(issue.domain),
      factId: stringValue(issue.factId),
      blocking: issue.blocking === true,
    };
  });
}

function schedulerSummary(
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  tracker: TruncationTracker,
): WeeklyPlanningTraceSchedulerSummary {
  const runtimeInput = latestEventData(events, 'runtime_turn_input');
  const runtime = latestEventData(events, 'runtime_scheduler_dialogue_evaluated');
  const schedulerInput = record(runtime.schedulerInput);
  const context = Object.keys(record(runtime.schedulerContext)).length > 0
    ? record(runtime.schedulerContext)
    : record(schedulerInput.context);
  const compilation = record(runtime.compilation);
  const dialogue = record(runtime.dialogue);
  const projectedDialogue = record(runtime.dialogue);
  const selectedQuestion = Object.keys(record(runtime.selectedQuestion)).length > 0
    ? record(runtime.selectedQuestion)
    : record(projectedDialogue.selectedQuestion);
  const previewEvent = latestEventData(events, 'runtime_preview_scheduler_evaluated');
  const previewResult = Object.keys(record(previewEvent.result)).length > 0
    ? record(previewEvent.result)
    : previewEvent;
  const candidates = Array.isArray(previewResult.candidates) ? previewResult.candidates : [];
  const unscheduled = Array.isArray(previewResult.unscheduledWorkItems)
    ? previewResult.unscheduledWorkItems
    : Array.isArray(previewResult.unscheduled)
      ? previewResult.unscheduled
      : [];
  const previewExists = Object.keys(previewEvent).length > 0;
  return {
    selectedDate: stringValue(runtime.selectedDate)
      ?? stringValue(context.currentDate)
      ?? stringValue(runtimeInput.selectedDate),
    timeZone: stringValue(runtime.timeZone) ?? stringValue(context.timeZone),
    planningHorizon: boundedUnknown(
      runtime.resolvedHorizon ?? runtime.planningHorizon ?? null,
      1_000,
      tracker,
      'constraintContext.scheduler.planningHorizon',
    ),
    externalSources: sourceSummaries(runtime, tracker),
    compilationStatus: stringValue(compilation.status),
    issues: issueSummaries(runtime, tracker),
    dialogueStatus: stringValue(dialogue.status),
    selectedQuestionCode: stringValue(record(runtime.dialogue).selectedQuestionCode)
      ?? stringValue(selectedQuestion.code)
      ?? stringValue(runtime.firstBlockingIssueCodeInCompilationOrder),
    preview: previewExists
      ? {
          schedulerVersion: stringValue(previewEvent.schedulerVersion),
          status: stringValue(previewResult.status),
          candidateCount: numberValue(previewEvent.candidateCount) ?? candidates.length,
          unscheduledCount: numberValue(previewEvent.unscheduledCount) ?? unscheduled.length,
          representativeCandidates: limitedArray(
            candidates.length > 0 ? candidates : (Array.isArray(previewEvent.candidates) ? previewEvent.candidates : []),
            NORMAL_LIMITS.previewCandidates,
            tracker,
            'constraintContext.scheduler.preview.representativeCandidates',
          ).map((candidate, index) => boundedUnknown(
            candidate,
            1_000,
            tracker,
            `constraintContext.scheduler.preview.representativeCandidates[${index}]`,
          )),
        }
      : null,
    duplicateSuppressed: hasEvent(events, 'runtime_duplicate_turn_suppressed'),
  };
}

function errorFromValue(
  value: unknown,
  tracker: TruncationTracker,
  field: string,
): { type: string; message: string } | null {
  const candidate = record(value);
  const nested = isRecord(candidate.error) ? candidate.error : candidate;
  const message = stringValue(nested.message)
    ?? stringValue(nested.traceCode)
    ?? stringValue(nested.code);
  if (!message) return null;
  return {
    type: boundedText(
      stringValue(nested.name) ?? stringValue(nested.type) ?? stringValue(nested.code) ?? 'Error',
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
  const projection = latestEventData(events, 'turn_executor_result_projected');
  const recordedFailure = errorFromValue(projection.recordedFailure, tracker, 'diagnostics.error');
  if (recordedFailure) return recordedFailure;
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
  const times = events.map((event) => Date.parse(event.occurredAt))
    .filter((value) => Number.isFinite(value));
  if (times.length < 2) {
    const decision = latestEventData(events, 'semantic_normalizer_decision');
    return numberValue(record(decision.diagnostics).latencyMs);
  }
  return Math.max(...times) - Math.min(...times);
}

function responseSource(
  outcome: string,
  events: readonly WeeklyPlanningStableV5DebugTraceEvent[],
  hasError: boolean,
): WeeklyPlanningTraceResponseSource {
  if (outcome.includes('fallback')) return 'deterministic_fallback';
  if (hasError
    || hasEvent(events, 'runtime_turn_threw')
    || hasEvent(events, 'runtime_duplicate_turn_suppressed')) return 'system';
  const branch = stringValue(latestEventData(events, 'runtime_branch_selected').branch);
  if (branch === 'provider_failure'
    || branch === 'normalization_rejected'
    || branch === 'canonicalization_rejected') return 'system';
  return 'rules';
}

function rejectedOperations(params: {
  validations: WeeklyPlanningTraceAiValidationResult[];
  aiCandidates: unknown[];
  canonicalizationBranch: string | null;
  canonicalizationErrors: string[];
  tracker: TruncationTracker;
}): WeeklyPlanningTraceRejectedOperation[] {
  const rejected: WeeklyPlanningTraceRejectedOperation[] = [];
  params.validations.filter((result) => !result.accepted).forEach((result) => {
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

function metadata(tracker: TruncationTracker): WeeklyPlanningTraceTruncationMetadata {
  return {
    applied: tracker.fields.size > 0,
    fields: [...tracker.fields].sort(),
    originalCounts: { ...tracker.originalCounts },
  };
}

function compact(
  entry: DiagnosticWithTruncation,
  tracker: TruncationTracker,
  minimal: boolean,
): DiagnosticWithTruncation {
  markField(tracker, minimal ? 'diagnostics.minimalCompaction' : 'diagnostics.emergencyCompaction');
  const textBytes = minimal ? 500 : 1_500;
  const operationBytes = minimal ? 300 : 600;
  const operationCount = minimal ? 1 : 4;
  const parserCount = minimal ? 1 : 6;
  const scheduler = entry.constraintContext.scheduler;
  const compacted: DiagnosticWithTruncation = {
    ...entry,
    userInput: { text: boundedText(entry.userInput.text, textBytes, tracker, 'userInput.text') },
    aiInterpreter: {
      ...entry.aiInterpreter,
      input: {
        userText: boundedText(entry.aiInterpreter.input.userText, textBytes, tracker,
          'aiInterpreter.input.userText'),
        conversationContext: limitedArray(
          entry.aiInterpreter.input.conversationContext,
          minimal ? 2 : 4,
          tracker,
          'aiInterpreter.input.conversationContext',
          true,
        ).map((message, index) => ({
          role: boundedText(message.role, 64, tracker,
            `aiInterpreter.input.conversationContext[${index}].role`),
          content: boundedText(message.content, minimal ? 400 : 750, tracker,
            `aiInterpreter.input.conversationContext[${index}].content`),
        })),
        planningStateSummary: minimal ? null : boundedUnknown(
          entry.aiInterpreter.input.planningStateSummary,
          1_000,
          tracker,
          'aiInterpreter.input.planningStateSummary',
        ),
        requests: minimal ? [] : limitedArray(
          entry.aiInterpreter.input.requests,
          1,
          tracker,
          'aiInterpreter.input.requests',
        ).map((request, index) => ({
          ...request,
          messages: limitedArray(request.messages, 3, tracker,
            `aiInterpreter.input.requests[${index}].messages`).map((message, messageIndex) => ({
            role: boundedText(message.role, 64, tracker,
              `aiInterpreter.input.requests[${index}].messages[${messageIndex}].role`),
            content: boundedText(message.content, 600, tracker,
              `aiInterpreter.input.requests[${index}].messages[${messageIndex}].content`),
          })),
          responseFormat: boundedUnknown(request.responseFormat, 500, tracker,
            `aiInterpreter.input.requests[${index}].responseFormat`),
        })),
      },
      rawResponses: limitedArray(
        entry.aiInterpreter.rawResponses,
        1,
        tracker,
        'aiInterpreter.rawResponses',
      ).map((response, index) => rawResponse({
        attempt: response.attempt,
        rawResponse: response.text,
        rawResponseOriginalBytes: response.originalBytes,
        rawResponseTruncated: response.truncated,
        rawResponseChecksum: response.checksum,
      }, index, tracker, minimal ? 700 : 1_500)),
      structuredResults: minimal ? [] : limitedArray(
        entry.aiInterpreter.structuredResults,
        1,
        tracker,
        'aiInterpreter.structuredResults',
      ).map((result, index) => ({
        ...result,
        errors: limitedArray(result.errors, 5, tracker,
          `aiInterpreter.structuredResults[${index}].errors`),
        structuredResult: boundedUnknown(result.structuredResult, 1_000, tracker,
          `aiInterpreter.structuredResults[${index}].structuredResult`),
      })),
      candidateOperations: limitedArray(
        entry.aiInterpreter.candidateOperations,
        operationCount,
        tracker,
        'aiInterpreter.candidateOperations',
      ).map((value, index) => boundedUnknown(value, operationBytes, tracker,
        `aiInterpreter.candidateOperations[${index}]`)),
    },
    parsers: limitedArray(
      [...entry.parsers.filter((item) => item.accepted), ...entry.parsers.filter((item) => !item.accepted)],
      parserCount,
      tracker,
      'parsers',
    ).map((item, index) => ({
      ...item,
      inputText: boundedNullableText(item.inputText, 400, tracker, `parsers[${index}].inputText`),
      matchedText: boundedNullableText(item.matchedText, 300, tracker, `parsers[${index}].matchedText`),
      candidateOperation: boundedUnknown(item.candidateOperation, operationBytes, tracker,
        `parsers[${index}].candidateOperation`),
      reason: boundedNullableText(item.reason, 400, tracker, `parsers[${index}].reason`),
    })),
    decision: {
      ...entry.decision,
      acceptedOperations: limitedArray(entry.decision.acceptedOperations, operationCount, tracker,
        'decision.acceptedOperations').map((value, index) => boundedUnknown(value, operationBytes,
        tracker, `decision.acceptedOperations[${index}]`)),
      rejectedOperations: minimal ? [] : limitedArray(entry.decision.rejectedOperations,
        operationCount, tracker, 'decision.rejectedOperations').map((value, index) => ({
        operation: boundedUnknown(value.operation, operationBytes, tracker,
          `decision.rejectedOperations[${index}].operation`),
        reason: boundedText(value.reason, 400, tracker,
          `decision.rejectedOperations[${index}].reason`),
      })),
      finalOperations: minimal ? [] : limitedArray(entry.decision.finalOperations,
        operationCount, tracker, 'decision.finalOperations').map((value, index) => boundedUnknown(
        value, operationBytes, tracker, `decision.finalOperations[${index}]`)),
      stateDiff: boundedUnknown(entry.decision.stateDiff, minimal ? 1_000 : 2_000, tracker,
        'decision.stateDiff'),
    },
    constraintContext: {
      ...entry.constraintContext,
      relevantBusyIntervals: limitedArray(entry.constraintContext.relevantBusyIntervals,
        minimal ? 10 : 30, tracker, 'constraintContext.relevantBusyIntervals'),
      ...(scheduler ? {
        scheduler: {
          ...scheduler,
          issues: limitedArray(scheduler.issues, minimal ? 5 : 10, tracker,
            'constraintContext.scheduler.issues'),
          preview: scheduler.preview ? {
            ...scheduler.preview,
            representativeCandidates: minimal ? [] : limitedArray(
              scheduler.preview.representativeCandidates,
              5,
              tracker,
              'constraintContext.scheduler.preview.representativeCandidates',
            ).map((value, index) => boundedUnknown(value, 500, tracker,
              `constraintContext.scheduler.preview.representativeCandidates[${index}]`)),
          } : null,
        },
      } : {}),
    },
    assistantOutput: {
      ...entry.assistantOutput,
      text: boundedNullableText(entry.assistantOutput.text, textBytes, tracker, 'assistantOutput.text'),
    },
    diagnostics: {
      ...entry.diagnostics,
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
    <= WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes) return entry;
  const compacted = compact(entry, tracker, false);
  if (measureWeeklyPlanningTraceJsonBytes(compacted)
    <= WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes) return compacted;
  const minimal = compact(compacted, tracker, true);
  if (measureWeeklyPlanningTraceJsonBytes(minimal)
    <= WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes) return minimal;
  markField(tracker, 'diagnostics.lastResortCompaction');
  minimal.aiInterpreter.rawResponses = [];
  minimal.aiInterpreter.candidateOperations = [];
  minimal.parsers = minimal.parsers.filter((item) => item.accepted).slice(0, 1);
  minimal.decision.acceptedOperations = [];
  minimal.decision.rejectedOperations = [];
  minimal.decision.finalOperations = [];
  minimal.constraintContext.relevantBusyIntervals = [];
  if (minimal.constraintContext.scheduler?.preview) {
    minimal.constraintContext.scheduler.preview.representativeCandidates = [];
  }
  minimal.diagnostics.truncation = metadata(tracker);
  return minimal;
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
  const status = stringValue(canonicalResult.status)
    ?? stringValue(pipelineDecision.selectedStatus)
    ?? stringValue(branch.branch)
    ?? input.outcome;
  const error = firstError(events, tracker, input.errorCode);
  const acceptedSource = canonicalizationBranch === 'contextual_answer_binding' ? 'parser' : 'ai';
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
      provider: boundedNullableText(stringValue(configuration.provider), 256, tracker,
        'aiInterpreter.provider'),
      model: boundedNullableText(stringValue(configuration.model), 256, tracker,
        'aiInterpreter.model'),
      promptVersion: boundedNullableText(stringValue(prepared.normalizerVersion), 256, tracker,
        'aiInterpreter.promptVersion'),
      input: {
        userText: boundedText(input.userText, NORMAL_LIMITS.textBytes, tracker,
          'aiInterpreter.input.userText'),
        conversationContext: recentConversation,
        planningStateSummary: boundedUnknown(
          pipelineInput.publicStateSummary ?? null,
          3_000,
          tracker,
          'aiInterpreter.input.planningStateSummary',
        ),
        requests: aiRequests(events, tracker),
      },
      rawResponses: rawResponses(events, tracker),
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
      precedence: boundedNullableText(canonicalizationBranch, 500, tracker, 'decision.precedence'),
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
      scheduler: schedulerSummary(events, tracker),
    },
    assistantOutput: {
      text: boundedNullableText(input.assistantMessage ?? null, NORMAL_LIMITS.textBytes, tracker,
        'assistantOutput.text'),
      responseSource: responseSource(input.outcome, events, Boolean(error)),
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
