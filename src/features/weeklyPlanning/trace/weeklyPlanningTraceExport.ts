import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceInternalEventEntry,
  WeeklyPlanningTraceSession,
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
  latency: null;
  fallbackCategory: string | null;
}

export interface WeeklyPlanningRoleplayCandidate {
  candidateId: string;
  requiresHumanReview: true;
  sourceSchemaVersion: number;
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface WeeklyPlanningTraceExportBundle {
  exportedAt: string;
  schemaVersion: number;
  session: WeeklyPlanningTraceSession;
  entries: WeeklyPlanningTraceEntry[];
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

export function createWeeklyPlanningEvaluationFixtureCandidate(
  session: WeeklyPlanningTraceSession,
  entries: readonly WeeklyPlanningTraceEntry[],
): WeeklyPlanningEvaluationFixtureCandidate {
  const events = internalEvents(entries);
  const fallback = events.find((entry) => entry.eventType === 'fallback_used');
  const finalStateRevision = entries.reduce<number | null>(
    (latest, entry) => typeof entry.stateRevision === 'number'
      ? Math.max(latest ?? entry.stateRevision, entry.stateRevision)
      : latest,
    null,
  );

  return {
    caseId: `trace:${session.id}`,
    requirementIds: [],
    turns: entries
      .filter((entry) => entry.kind === 'turn')
      .map((entry) => ({ role: entry.role, content: entry.content })),
    strictResults: {
      staleAsyncDiscarded: events.some((entry) => entry.eventType === 'stale_async_result_discarded'),
      stalePreviewRejected: events.some((entry) =>
        entry.eventType === 'preview_gate_evaluated'
          && eventPayloadRecord(entry).allowed === false
          && String(eventPayloadRecord(entry).reason ?? '').includes('stale'),
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
    latency: null,
    fallbackCategory: fallback
      ? String(eventPayloadRecord(fallback).category ?? 'unknown')
      : null,
  };
}

export function createWeeklyPlanningRoleplayCandidate(
  session: WeeklyPlanningTraceSession,
  entries: readonly WeeklyPlanningTraceEntry[],
): WeeklyPlanningRoleplayCandidate {
  return {
    candidateId: `roleplay:${session.id}`,
    requiresHumanReview: true,
    sourceSchemaVersion: session.schemaVersion,
    turns: entries
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
  return {
    exportedAt,
    schemaVersion: session.schemaVersion,
    session: { ...session },
    entries: entries.map((entry) => ({ ...entry })),
    evaluationFixtureCandidate: createWeeklyPlanningEvaluationFixtureCandidate(session, entries),
    roleplayCandidate: createWeeklyPlanningRoleplayCandidate(session, entries),
  };
}
