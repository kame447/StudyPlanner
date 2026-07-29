export const WEEKLY_PLANNING_STABLE_V5_DEBUG_TRACE_SCHEMA_VERSION = 2;

export type WeeklyPlanningStableV5DebugTraceSeverity =
  | 'debug'
  | 'info'
  | 'warn'
  | 'error';

export interface WeeklyPlanningStableV5DebugTraceEvent {
  schemaVersion: typeof WEEKLY_PLANNING_STABLE_V5_DEBUG_TRACE_SCHEMA_VERSION;
  sequence: number;
  stage: string;
  occurredAt: string;
  severity: WeeklyPlanningStableV5DebugTraceSeverity;
  data: unknown;
}

interface ActiveWeeklyPlanningStableV5DebugTrace {
  nextSequence: number;
  events: WeeklyPlanningStableV5DebugTraceEvent[];
  serializedBytes: number;
  droppedEvents: number;
}

const MAX_ACTIVE_REQUESTS = 128;
const MAX_EVENTS_PER_REQUEST = 64;
const MAX_EVENT_BYTES = 32 * 1024;
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_GENERIC_ARRAY_ITEMS = 40;
const MAX_GENERIC_OBJECT_KEYS = 50;
const MAX_GENERIC_DEPTH = 5;
const MAX_GENERIC_STRING_BYTES = 2_000;
const MAX_RAW_RESPONSE_BYTES = 4_000;
const activeTraces = new Map<string, ActiveWeeklyPlanningStableV5DebugTrace>();

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

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function utf8ByteLength(value: string): number {
  return utf8Bytes(value).byteLength;
}

function decodeUtf8Prefix(bytes: Uint8Array, maxBytes: number): string {
  return new TextDecoder().decode(bytes.slice(0, Math.max(0, maxBytes)));
}

function decodeUtf8Suffix(bytes: Uint8Array, maxBytes: number): string {
  const start = Math.max(0, bytes.byteLength - Math.max(0, maxBytes));
  return new TextDecoder().decode(bytes.slice(start));
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = utf8Bytes(value);
  if (bytes.byteLength <= maxBytes) return value;
  const marker = '…[trace truncated]';
  const markerBytes = utf8ByteLength(marker);
  return `${decodeUtf8Prefix(bytes, Math.max(0, maxBytes - markerBytes))}${marker}`;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of utf8Bytes(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function projectedRawResponse(value: unknown): Record<string, unknown> {
  const text = stringValue(value) ?? '';
  const bytes = utf8Bytes(text);
  const checksum = fnv1a32(text);
  if (bytes.byteLength <= MAX_RAW_RESPONSE_BYTES) {
    return {
      rawResponse: text,
      rawResponseOriginalBytes: bytes.byteLength,
      rawResponseTruncated: false,
      rawResponseChecksum: checksum,
    };
  }
  const metadata = `[trace head-tail originalBytes=${bytes.byteLength} checksum=${checksum}]`;
  const metadataBytes = utf8ByteLength(metadata) + 2;
  const contentBudget = Math.max(400, MAX_RAW_RESPONSE_BYTES - metadataBytes);
  const headBudget = Math.floor(contentBudget * 0.65);
  const tailBudget = contentBudget - headBudget;
  return {
    rawResponse: `${decodeUtf8Prefix(bytes, headBudget)}\n${metadata}\n${decodeUtf8Suffix(bytes, tailBudget)}`,
    rawResponseOriginalBytes: bytes.byteLength,
    rawResponseTruncated: true,
    rawResponseChecksum: checksum,
  };
}

function compactUnknown(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return truncateUtf8(value, MAX_GENERIC_STRING_BYTES);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return null;
  }
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_GENERIC_DEPTH) return '[trace depth limit]';
  if (Array.isArray(value)) {
    const selected = value.slice(0, MAX_GENERIC_ARRAY_ITEMS)
      .map((item) => compactUnknown(item, depth + 1));
    if (value.length > selected.length) {
      selected.push({ traceTruncatedItems: value.length - selected.length });
    }
    return selected;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).slice(0, MAX_GENERIC_OBJECT_KEYS);
    const result: Record<string, unknown> = {};
    entries.forEach(([key, item]) => {
      result[key] = compactUnknown(item, depth + 1);
    });
    if (Object.keys(value).length > entries.length) {
      result.traceTruncatedKeys = Object.keys(value).length - entries.length;
    }
    return result;
  }
  return String(value);
}

function compactMessages(value: unknown, limit = 8): Array<{ role: string; content: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(-limit).flatMap((item) => {
    const candidate = record(item);
    const role = stringValue(candidate.role);
    const content = stringValue(candidate.content);
    return role && content ? [{ role: truncateUtf8(role, 64), content: truncateUtf8(content, 1_500) }] : [];
  });
}

function externalSourceProjection(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((sourceValue) => {
    const source = record(sourceValue);
    const events = Array.isArray(source.events) ? source.events : [];
    return {
      kind: stringValue(source.kind) ?? 'unknown',
      status: stringValue(source.status) ?? 'unknown',
      failureKind: stringValue(source.failureKind),
      eventCount: events.length,
      events: events.slice(0, 100).map((eventValue) => {
        const event = record(eventValue);
        const start = record(event.start);
        const end = record(event.end);
        return {
          start: {
            date: stringValue(start.date),
            time: stringValue(start.time),
          },
          end: {
            date: stringValue(end.date),
            time: stringValue(end.time),
          },
        };
      }),
    };
  });
}

function issueProjection(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((issueValue) => {
    const issue = record(issueValue);
    return {
      code: stringValue(issue.code),
      domain: stringValue(issue.domain),
      factId: stringValue(issue.factId),
      blocking: issue.blocking === true,
      details: compactUnknown(issue.details),
    };
  });
}

function schedulerProjection(data: Record<string, unknown>): Record<string, unknown> {
  const schedulerInput = record(data.schedulerInput);
  const compilation = record(data.compilation);
  const dialogue = record(data.dialogue);
  const selectedQuestion = record(data.selectedQuestion);
  const authorization = record(data.authorization);
  const context = record(schedulerInput.context);
  return {
    selectedDate: stringValue(context.currentDate),
    timeZone: stringValue(context.timeZone),
    resolvedHorizon: compactUnknown(data.resolvedHorizon),
    externalSources: externalSourceProjection(schedulerInput.externalSources),
    compilation: {
      status: stringValue(compilation.status),
      issueCount: Array.isArray(compilation.issues) ? compilation.issues.length : 0,
      issues: issueProjection(compilation.issues),
    },
    dialogue: {
      status: stringValue(dialogue.status),
      selectedQuestionCode: stringValue(selectedQuestion.code),
      selectedQuestion: compactUnknown(data.selectedQuestion),
    },
    authorization: {
      planningIntent: stringValue(authorization.planningIntent),
      authorized: authorization.authorized === true,
    },
    firstBlockingIssueCodeInCompilationOrder:
      stringValue(data.firstBlockingIssueCodeInCompilationOrder),
  };
}

function previewProjection(data: Record<string, unknown>): Record<string, unknown> {
  const result = record(data.result);
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const unscheduled = Array.isArray(result.unscheduledWorkItems)
    ? result.unscheduledWorkItems
    : Array.isArray(result.unscheduled)
      ? result.unscheduled
      : [];
  return {
    schedulerVersion: stringValue(data.schedulerVersion),
    status: stringValue(result.status),
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 20).map((candidate) => compactUnknown(candidate)),
    unscheduledCount: unscheduled.length,
    unscheduledWorkItems: unscheduled.slice(0, 20).map((item) => compactUnknown(item)),
    defaultsAndCriteria: compactUnknown(data.defaultsAndCriteria),
  };
}

function outputProjection(value: unknown): Record<string, unknown> {
  const output = record(value);
  const state = record(output.state);
  return {
    message: stringValue(output.message),
    stateStatus: stringValue(state.status),
    questionCount: Array.isArray(state.questions) ? state.questions.length : 0,
    shouldCreateDraft: state.shouldCreateDraft === true,
    draftGenerationIntent: stringValue(state.draftGenerationIntent),
    previewCandidateCount: Array.isArray(output.draftCandidates) ? output.draftCandidates.length : 0,
    failure: compactUnknown(output.failure),
  };
}

function projectStageData(stage: string, value: unknown): unknown {
  const data = record(value);
  switch (stage) {
    case 'runtime_turn_input':
      return {
        runtime: stringValue(data.runtime),
        userText: truncateUtf8(stringValue(data.userText) ?? '', 4_000),
        selectedDate: stringValue(data.selectedDate),
        timetableTermId: stringValue(data.timetableTermId),
        inputCounts: compactUnknown(data.inputCounts),
      };
    case 'runtime_configuration_evaluated':
      return {
        provider: stringValue(data.provider),
        model: stringValue(data.model),
        configError: stringValue(data.configError),
      };
    case 'runtime_session_context_prepared':
      return {
        graphRevision: numberValue(data.graphRevision),
        selectedDate: stringValue(data.selectedDate),
        fallbackHorizon: compactUnknown(data.fallbackHorizon),
        recentTurnLimit: numberValue(data.recentTurnLimit),
        recentConversation: compactMessages(data.recentConversation),
        publicStateSummary: compactUnknown(data.publicStateSummary),
        schedulerContext: compactUnknown(data.schedulerContext),
      };
    case 'semantic_pipeline_input':
      return {
        pipelineVersion: stringValue(data.pipelineVersion),
        expectedRevision: numberValue(data.expectedRevision),
        userText: truncateUtf8(stringValue(data.userText) ?? '', 4_000),
        recentConversation: compactMessages(data.recentConversation),
        publicStateSummary: compactUnknown(data.publicStateSummary),
        schedulerContext: compactUnknown(data.schedulerContext),
        externalSources: externalSourceProjection(data.externalSources),
      };
    case 'semantic_normalizer_prepared': {
      const request = record(data.request);
      return {
        normalizerVersion: stringValue(data.normalizerVersion),
        schemaVersion: stringValue(data.schemaVersion),
        request: {
          purpose: stringValue(request.purpose),
          maxCompletionTokens: numberValue(request.maxCompletionTokens),
          responseFormat: compactUnknown(request.responseFormat),
        },
      };
    }
    case 'semantic_provider_request': {
      const request = record(data.request);
      return {
        attempt: stringValue(data.attempt),
        requestBytes: numberValue(data.requestBytes),
        request: {
          messages: compactMessages(request.messages, 6),
          purpose: stringValue(request.purpose),
          responseFormat: compactUnknown(request.responseFormat),
          maxCompletionTokens: numberValue(request.maxCompletionTokens),
        },
      };
    }
    case 'semantic_provider_response':
      return {
        attempt: stringValue(data.attempt),
        responseLength: numberValue(data.responseLength),
        ...projectedRawResponse(data.rawResponse),
      };
    case 'semantic_provider_error':
    case 'runtime_turn_threw':
      return {
        attempt: stringValue(data.attempt),
        error: compactUnknown(data.error),
      };
    case 'semantic_validation_result':
      return {
        attempt: stringValue(data.attempt),
        accepted: data.accepted === true,
        errors: compactUnknown(data.errors),
        parsedDocument: compactUnknown(data.parsedDocument),
      };
    case 'contextual_question_inference':
    case 'contextual_answer_binding_evaluated':
      return compactUnknown(data);
    case 'semantic_canonicalization_evaluated': {
      const result = record(data.result);
      return {
        branch: stringValue(data.branch),
        result: { status: stringValue(result.status) },
        adoptedOperations: compactUnknown(data.adoptedOperations),
        localReferenceResolution: compactUnknown(data.localReferenceResolution),
        rejectionErrors: compactUnknown(data.rejectionErrors),
      };
    }
    case 'runtime_graph_staged':
      return {
        previousGraphRevision: numberValue(data.previousGraphRevision),
        canonicalization: compactUnknown(data.canonicalization),
      };
    case 'runtime_scheduler_dialogue_evaluated':
      return schedulerProjection(data);
    case 'runtime_preview_scheduler_evaluated':
      return previewProjection(data);
    case 'runtime_branch_selected':
      return {
        branch: stringValue(data.branch),
        basis: compactUnknown(data.basis),
        output: outputProjection(data.output),
      };
    case 'runtime_turn_output':
      return { finalDecision: compactUnknown(data.finalDecision) };
    case 'runtime_duplicate_turn_suppressed':
      return compactUnknown(data);
    case 'semantic_pipeline_decision':
      return {
        selectedStatus: stringValue(data.selectedStatus),
        basis: compactUnknown(data.basis),
      };
    case 'turn_executor_result_projected':
      return {
        branch: stringValue(data.branch),
        criteria: compactUnknown(data.criteria),
        recordedFailure: compactUnknown(data.recordedFailure),
        projectedResult: outputProjection(data.projectedResult),
      };
    default:
      return compactUnknown(data);
  }
}

function serializedBytes(value: unknown): number {
  try {
    return utf8ByteLength(JSON.stringify(value) ?? 'null');
  } catch {
    return MAX_EVENT_BYTES + 1;
  }
}

function boundedProjection(stage: string, value: unknown): unknown {
  const projected = projectStageData(stage, value);
  const bytes = serializedBytes(projected);
  if (bytes <= MAX_EVENT_BYTES) return projected;
  return {
    traceProjectionTruncated: true,
    stage,
    originalProjectedBytes: bytes,
    summary: compactUnknown(projected, MAX_GENERIC_DEPTH - 1),
  };
}

function cloneProjectedData(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
}

function cloneEvents(
  trace: ActiveWeeklyPlanningStableV5DebugTrace | undefined,
): WeeklyPlanningStableV5DebugTraceEvent[] {
  if (!trace) return [];
  const events = trace.events.map((event) => ({
    ...event,
    data: cloneProjectedData(event.data),
  }));
  if (trace.droppedEvents > 0) {
    events.push({
      schemaVersion: WEEKLY_PLANNING_STABLE_V5_DEBUG_TRACE_SCHEMA_VERSION,
      sequence: trace.nextSequence,
      stage: 'trace_collector_truncated',
      occurredAt: new Date().toISOString(),
      severity: 'warn',
      data: {
        droppedEvents: trace.droppedEvents,
        maxEvents: MAX_EVENTS_PER_REQUEST,
        maxRequestBytes: MAX_REQUEST_BYTES,
      },
    });
  }
  return events;
}

function trimOldestTraceIfNeeded(): void {
  while (activeTraces.size > MAX_ACTIVE_REQUESTS) {
    const oldestRequestId = activeTraces.keys().next().value;
    if (typeof oldestRequestId !== 'string') return;
    activeTraces.delete(oldestRequestId);
  }
}

function createTrace(): ActiveWeeklyPlanningStableV5DebugTrace {
  return {
    nextSequence: 0,
    events: [],
    serializedBytes: 0,
    droppedEvents: 0,
  };
}

function ensureTrace(requestId: string): ActiveWeeklyPlanningStableV5DebugTrace {
  const existing = activeTraces.get(requestId);
  if (existing) return existing;
  const created = createTrace();
  activeTraces.set(requestId, created);
  trimOldestTraceIfNeeded();
  return created;
}

export function beginWeeklyPlanningStableV5DebugTrace(requestId: string): void {
  activeTraces.set(requestId, createTrace());
  trimOldestTraceIfNeeded();
}

export function recordWeeklyPlanningStableV5DebugTrace(params: {
  requestId?: string;
  stage: string;
  data: unknown;
  severity?: WeeklyPlanningStableV5DebugTraceSeverity;
}): void {
  if (!params.requestId) return;
  const active = ensureTrace(params.requestId);
  const data = boundedProjection(params.stage, params.data);
  const eventBytes = serializedBytes(data);
  if (active.events.length >= MAX_EVENTS_PER_REQUEST
    || active.serializedBytes + eventBytes > MAX_REQUEST_BYTES) {
    active.droppedEvents += 1;
    return;
  }
  active.events.push({
    schemaVersion: WEEKLY_PLANNING_STABLE_V5_DEBUG_TRACE_SCHEMA_VERSION,
    sequence: active.nextSequence,
    stage: params.stage,
    occurredAt: new Date().toISOString(),
    severity: params.severity ?? 'debug',
    data,
  });
  active.nextSequence += 1;
  active.serializedBytes += eventBytes;
}

export function readWeeklyPlanningStableV5DebugTrace(
  requestId: string,
): WeeklyPlanningStableV5DebugTraceEvent[] {
  return cloneEvents(activeTraces.get(requestId));
}

export function clearWeeklyPlanningStableV5DebugTrace(requestId: string): void {
  activeTraces.delete(requestId);
}

export function takeWeeklyPlanningStableV5DebugTrace(
  requestId: string,
): WeeklyPlanningStableV5DebugTraceEvent[] {
  const events = readWeeklyPlanningStableV5DebugTrace(requestId);
  clearWeeklyPlanningStableV5DebugTrace(requestId);
  return events;
}

export function peekWeeklyPlanningStableV5DebugTraceForTest(
  requestId: string,
): WeeklyPlanningStableV5DebugTraceEvent[] {
  return readWeeklyPlanningStableV5DebugTrace(requestId);
}

export function resetWeeklyPlanningStableV5DebugTraceForTest(): void {
  activeTraces.clear();
}
