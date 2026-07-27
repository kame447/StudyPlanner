import { sanitizeWeeklyPlanningTraceValue } from './weeklyPlanningTraceRedaction';
import {
  isWeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceInternalEventEntry,
  type WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

export interface WeeklyPlanningEvaluationFixtureCandidate {
  caseId: string;
  requirementIds: string[];
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
  strictResults: {
    staleAsyncDiscarded: boolean;
    stalePreviewRejected: boolean;
    previewCompleted: boolean;
    duplicateSaveSuppressed: boolean;
  };
  rubricInput: {
    sessionStatus: WeeklyPlanningTraceSession['status'];
    eventTypes: string[];
    finalStateRevision: number | null;
  };
  callCount: number;
  latency: number | null;
  fallbackCategory: string | null;
}

export interface WeeklyPlanningRoleplayCandidate {
  candidateId: string;
  requiresHumanReview: true;
  sourceSchemaVersion: number;
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface WeeklyPlanningStableV5DebugStageExport {
  requestId: string | undefined;
  debugSequence: number;
  stage: string;
  stageOccurredAt: string;
  severity: WeeklyPlanningTraceInternalEventEntry['severity'];
  stateRevision: number | undefined;
  storage: 'inline_json' | 'reassembled_base64_utf8_json';
  sourceEntryIds: string[];
  sourceSanitizerTruncated: boolean;
  data?: unknown;
  reconstructionError?: string;
}

export interface WeeklyPlanningTraceExportBundle {
  exportedAt: string;
  schemaVersion: number;
  session: WeeklyPlanningTraceSession;
  entries: WeeklyPlanningTraceEntry[];
  stableV5DebugStages: WeeklyPlanningStableV5DebugStageExport[];
  evaluationFixtureCandidate: WeeklyPlanningEvaluationFixtureCandidate;
  roleplayCandidate: WeeklyPlanningRoleplayCandidate;
}

function internalEvents(
  entries: readonly WeeklyPlanningTraceEntry[],
): WeeklyPlanningTraceInternalEventEntry[] {
  return entries.filter(
    (entry): entry is WeeklyPlanningTraceInternalEventEntry => entry.kind === 'internal_event',
  );
}

function eventPayloadRecord(entry: WeeklyPlanningTraceInternalEventEntry): Record<string, unknown> {
  return entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
    ? entry.payload as Record<string, unknown>
    : {};
}

function hasSkippedDuplicate(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSkippedDuplicate);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.status === 'skipped_duplicate') return true;
  return Object.values(record).some(hasSkippedDuplicate);
}

function anonymizeRoleplayText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .replace(/(?:\+?81[-\s]?)?0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/g, '[PHONE]');
}

function finiteLatency(payload: Record<string, unknown>): number | null {
  for (const key of ['latencyMs', 'latency']) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function requirementIdsFromEvents(
  events: readonly WeeklyPlanningTraceInternalEventEntry[],
): string[] {
  const ids = new Set<string>();
  events.forEach((event) => {
    const value = eventPayloadRecord(event).requirementIds;
    if (!Array.isArray(value)) return;
    value.forEach((item) => {
      if (typeof item === 'string' && item.trim()) ids.add(item.trim());
    });
  });
  return Array.from(ids).sort();
}

function sanitizedEntries(entries: readonly WeeklyPlanningTraceEntry[]): WeeklyPlanningTraceEntry[] {
  return entries.flatMap((entry) => {
    const value = sanitizeWeeklyPlanningTraceValue(entry).value;
    return isWeeklyPlanningTraceEntry(value) ? [value] : [];
  });
}

function sanitizedSession(session: WeeklyPlanningTraceSession): WeeklyPlanningTraceSession {
  const value = sanitizeWeeklyPlanningTraceValue(session).value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...session };
  return value as WeeklyPlanningTraceSession;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('invalid-base64');
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

interface OrderedDebugStageExport {
  order: number;
  value: WeeklyPlanningStableV5DebugStageExport;
}

function inlineDebugStage(
  entry: WeeklyPlanningTraceInternalEventEntry,
  payload: Record<string, unknown>,
): OrderedDebugStageExport | null {
  const debugSequence = nonNegativeInteger(payload.debugSequence);
  const stage = stringValue(payload.stage);
  const stageOccurredAt = stringValue(payload.stageOccurredAt);
  if (debugSequence === null || !stage || !stageOccurredAt) return null;
  return {
    order: entry.sequence,
    value: {
      requestId: entry.requestId,
      debugSequence,
      stage,
      stageOccurredAt,
      severity: entry.severity,
      stateRevision: entry.stateRevision,
      storage: 'inline_json',
      sourceEntryIds: [entry.id],
      sourceSanitizerTruncated: payload.sourceSanitizerTruncated === true,
      data: payload.data,
    },
  };
}

function chunkGroupKey(
  entry: WeeklyPlanningTraceInternalEventEntry,
  payload: Record<string, unknown>,
): string | null {
  const debugSequence = nonNegativeInteger(payload.debugSequence);
  const stage = stringValue(payload.stage);
  const stageOccurredAt = stringValue(payload.stageOccurredAt);
  if (debugSequence === null || !stage || !stageOccurredAt) return null;
  return JSON.stringify([
    entry.requestId ?? null,
    debugSequence,
    stage,
    stageOccurredAt,
  ]);
}

function reassembleDebugChunkGroup(
  entries: WeeklyPlanningTraceInternalEventEntry[],
): OrderedDebugStageExport | null {
  const sortedByEntry = entries.slice().sort((left, right) => left.sequence - right.sequence);
  const first = sortedByEntry[0];
  if (!first) return null;
  const firstPayload = eventPayloadRecord(first);
  const debugSequence = nonNegativeInteger(firstPayload.debugSequence);
  const stage = stringValue(firstPayload.stage);
  const stageOccurredAt = stringValue(firstPayload.stageOccurredAt);
  const chunkCount = nonNegativeInteger(firstPayload.chunkCount);
  if (debugSequence === null || !stage || !stageOccurredAt || chunkCount === null || chunkCount < 1) {
    return null;
  }

  const byIndex = new Map<number, WeeklyPlanningTraceInternalEventEntry[]>();
  for (const entry of sortedByEntry) {
    const index = nonNegativeInteger(eventPayloadRecord(entry).chunkIndex);
    if (index === null) continue;
    const current = byIndex.get(index) ?? [];
    current.push(entry);
    byIndex.set(index, current);
  }

  let reconstructionError: string | undefined;
  const orderedEntries: WeeklyPlanningTraceInternalEventEntry[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const matches = byIndex.get(index) ?? [];
    if (matches.length === 0) {
      reconstructionError = `missing-chunk:${index}/${chunkCount}`;
      break;
    }
    if (matches.length > 1) {
      reconstructionError = `duplicate-chunk:${index}/${chunkCount}`;
      break;
    }
    orderedEntries.push(matches[0]);
  }

  let data: unknown;
  if (!reconstructionError) {
    try {
      const chunks = orderedEntries.map((entry, index) => {
        const payload = eventPayloadRecord(entry);
        const value = stringValue(payload.dataChunk);
        if (!value) throw new Error(`missing-data:${index}`);
        return decodeBase64(value);
      });
      const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const reconstructed = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        reconstructed.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const expectedBytes = nonNegativeInteger(firstPayload.totalSerializedBytes);
      if (expectedBytes !== null && expectedBytes !== totalBytes) {
        reconstructionError = `serialized-byte-length-mismatch:${totalBytes}/${expectedBytes}`;
      } else {
        data = JSON.parse(new TextDecoder().decode(reconstructed));
      }
    } catch (error) {
      reconstructionError = error instanceof Error
        ? `reconstruction-failed:${error.message}`
        : 'reconstruction-failed:unknown';
    }
  }

  const value: WeeklyPlanningStableV5DebugStageExport = {
    requestId: first.requestId,
    debugSequence,
    stage,
    stageOccurredAt,
    severity: first.severity,
    stateRevision: first.stateRevision,
    storage: 'reassembled_base64_utf8_json',
    sourceEntryIds: orderedEntries.length > 0
      ? orderedEntries.map((entry) => entry.id)
      : sortedByEntry.map((entry) => entry.id),
    sourceSanitizerTruncated: sortedByEntry.some(
      (entry) => eventPayloadRecord(entry).sourceSanitizerTruncated === true,
    ),
  };
  if (reconstructionError) value.reconstructionError = reconstructionError;
  else value.data = data;

  return { order: first.sequence, value };
}

export function createWeeklyPlanningStableV5DebugStageExport(
  entries: readonly WeeklyPlanningTraceEntry[],
): WeeklyPlanningStableV5DebugStageExport[] {
  const safeEntries = sanitizedEntries(entries);
  const debugEntries = internalEvents(safeEntries)
    .filter((entry) => entry.eventType === 'stable_v5_debug_stage')
    .sort((left, right) => left.sequence - right.sequence);
  const ordered: OrderedDebugStageExport[] = [];
  const chunkGroups = new Map<string, WeeklyPlanningTraceInternalEventEntry[]>();

  for (const entry of debugEntries) {
    const payload = eventPayloadRecord(entry);
    if (payload.storage === 'inline_json') {
      const stage = inlineDebugStage(entry, payload);
      if (stage) ordered.push(stage);
      continue;
    }
    if (payload.storage !== 'base64_utf8_json_chunk') continue;
    const key = chunkGroupKey(entry, payload);
    if (!key) continue;
    const group = chunkGroups.get(key) ?? [];
    group.push(entry);
    chunkGroups.set(key, group);
  }

  for (const group of chunkGroups.values()) {
    const stage = reassembleDebugChunkGroup(group);
    if (stage) ordered.push(stage);
  }

  return ordered
    .sort((left, right) => left.order - right.order)
    .map((item) => item.value);
}

export function createWeeklyPlanningEvaluationFixtureCandidate(
  session: WeeklyPlanningTraceSession,
  entries: readonly WeeklyPlanningTraceEntry[],
): WeeklyPlanningEvaluationFixtureCandidate {
  const safeEntries = sanitizedEntries(entries);
  const events = internalEvents(safeEntries);
  const fallback = events.find((entry) => entry.eventType === 'fallback_used');
  const finalStateRevision = safeEntries.reduce<number | null>(
    (latest, entry) => typeof entry.stateRevision === 'number'
      ? Math.max(latest ?? entry.stateRevision, entry.stateRevision)
      : latest,
    null,
  );
  const latencyValues = events
    .map((event) => finiteLatency(eventPayloadRecord(event)))
    .filter((value): value is number => value !== null);

  return {
    caseId: `trace:${session.id}`,
    requirementIds: requirementIdsFromEvents(events),
    turns: safeEntries
      .filter((entry) => entry.kind === 'turn')
      .map((entry) => ({ role: entry.role, content: entry.content })),
    strictResults: {
      staleAsyncDiscarded: events.some((entry) => entry.eventType === 'stale_async_result_discarded'),
      stalePreviewRejected: events.some((entry) =>
        entry.eventType === 'preview_rejected_stale'
          || (entry.eventType === 'preview_gate_evaluated'
            && eventPayloadRecord(entry).allowed === false
            && String(eventPayloadRecord(entry).reason ?? '').includes('stale')),
      ),
      previewCompleted: events.some((entry) => entry.eventType === 'preview_generated'),
      duplicateSaveSuppressed: events
        .filter((entry) => entry.eventType === 'approval_completed')
        .some((entry) => hasSkippedDuplicate(entry.payload)),
    },
    rubricInput: {
      sessionStatus: session.status,
      eventTypes: events.map((entry) => entry.eventType),
      finalStateRevision,
    },
    callCount: events.filter((entry) => entry.eventType === 'interpreter_completed').length,
    latency: latencyValues.length > 0
      ? latencyValues.reduce((sum, value) => sum + value, 0)
      : null,
    fallbackCategory: fallback
      ? String(eventPayloadRecord(fallback).category ?? 'unknown')
      : null,
  };
}

export function createWeeklyPlanningRoleplayCandidate(
  session: WeeklyPlanningTraceSession,
  entries: readonly WeeklyPlanningTraceEntry[],
): WeeklyPlanningRoleplayCandidate {
  const safeEntries = sanitizedEntries(entries);
  return {
    candidateId: `roleplay:${session.id}`,
    requiresHumanReview: true,
    sourceSchemaVersion: session.schemaVersion,
    turns: safeEntries
      .filter((entry) => entry.kind === 'turn')
      .map((entry) => ({
        role: entry.role,
        content: anonymizeRoleplayText(entry.content),
      })),
  };
}

export function createWeeklyPlanningTraceExportBundle(
  session: WeeklyPlanningTraceSession,
  entries: readonly WeeklyPlanningTraceEntry[],
  exportedAt = new Date().toISOString(),
): WeeklyPlanningTraceExportBundle {
  const safeSession = sanitizedSession(session);
  const safeEntries = sanitizedEntries(entries);
  return {
    exportedAt,
    schemaVersion: safeSession.schemaVersion,
    session: safeSession,
    entries: safeEntries,
    stableV5DebugStages: createWeeklyPlanningStableV5DebugStageExport(safeEntries),
    evaluationFixtureCandidate: createWeeklyPlanningEvaluationFixtureCandidate(
      safeSession,
      safeEntries,
    ),
    roleplayCandidate: createWeeklyPlanningRoleplayCandidate(safeSession, safeEntries),
  };
}
