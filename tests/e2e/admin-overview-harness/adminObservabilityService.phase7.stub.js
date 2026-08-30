export * from './adminObservabilityService.phase6.stub.js';

const harnessState = new URLSearchParams(window.location.search).get('state') ?? 'populated';
const sessionId = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';

const session = {
  source: 'weekly_planning_trace',
  traceSessionId: sessionId,
  subjectAlias: 'subject-a1b2c3d4e5f6',
  status: 'failed',
  severity: 'error',
  startedAt: '2026-08-29T10:00:00.000Z',
  lastActivityAt: '2026-08-29T10:04:20.000Z',
  endedAt: '2026-08-29T10:04:20.000Z',
  planningRangeStart: '2026-08-31',
  planningRangeEnd: '2026-09-06',
  entryCount: 24,
  turnCount: 3,
  hasPreview: true,
  hasApprovalFailure: true,
  hasFallback: true,
  hasError: true,
  appVersion: '2026.8.29',
  traceSchemaVersion: 2,
  summary: 'error · fallback · approval failure · preview reached',
};

const entries = [
  {
    id: `${sessionId}-00000000`,
    source: 'weekly_planning_trace',
    feature: 'weekly_planning',
    occurredAt: '2026-08-29T10:00:10.000Z',
    severity: 'info',
    subjectAlias: session.subjectAlias,
    traceSessionId: sessionId,
    requestId: 'request-semantic-001',
    stateRevision: 2,
    eventType: 'turn_diagnostic:accepted',
    summary: 'turn 1 · interpreted',
    detail: {
      id: `${sessionId}-00000000`,
      kind: 'turn_diagnostic',
      requestId: 'request-semantic-001',
      diagnostics: { outcome: 'interpreted', stale: false },
    },
  },
  {
    id: `${sessionId}-00000001`,
    source: 'weekly_planning_trace',
    feature: 'weekly_planning',
    occurredAt: '2026-08-29T10:03:30.000Z',
    severity: 'error',
    subjectAlias: session.subjectAlias,
    traceSessionId: sessionId,
    requestId: 'request-save-002',
    stateRevision: 5,
    eventType: 'approval_failed',
    summary: 'approval_failed · status: rejected',
    detail: {
      id: `${sessionId}-00000001`,
      kind: 'internal_event',
      eventType: 'approval_failed',
      severity: 'error',
      payload: { status: 'rejected' },
    },
  },
];

export async function getAdminObservabilityLogs() {
  if (harnessState === 'error') throw new Error('Harness restricted diagnostic read failed.');
  return {
    sessions: harnessState === 'empty' ? [] : [session],
    nextCursor: null,
  };
}

export async function getAdminObservabilityLogEntries() {
  if (harnessState === 'error') throw new Error('Harness restricted diagnostic entry read failed.');
  return {
    entries: harnessState === 'empty' ? [] : entries,
    totalEntryCount: harnessState === 'empty' ? 0 : entries.length,
    nextAfterSequence: null,
    responseBytes: harnessState === 'empty' ? 0 : 2048,
  };
}

export async function getAdminObservabilityDebugBundle({ requestId } = {}) {
  if (harnessState === 'error') throw new Error('Harness Debug Bundle generation failed.');
  const selected = requestId ? entries.filter((entry) => entry.requestId === requestId) : entries;
  return {
    schema: 'studyplanner-debug-bundle',
    schemaVersion: 1,
    generatedAt: '2026-08-29T11:00:00.000Z',
    selection: {
      source: 'weekly_planning_trace',
      traceSessionId: sessionId,
      requestId: requestId ?? null,
      period: { from: session.startedAt, to: session.lastActivityAt },
    },
    correlation: {
      subjectAlias: session.subjectAlias,
      traceSessionId: sessionId,
      requestIds: selected.map((entry) => entry.requestId).filter(Boolean),
    },
    versions: {
      appVersion: session.appVersion,
      traceSchemaVersion: 2,
      models: ['gpt-5.6-luna'],
      promptVersions: ['stable-v5'],
      schedulerVersions: ['stable-v5'],
    },
    metrics: {
      sessionStatus: session.status,
      turnCount: session.turnCount,
      totalEntryCount: entries.length,
      includedEntryCount: selected.length,
      hasPreview: true,
      hasApprovalFailure: true,
      hasFallback: true,
      hasError: true,
    },
    entries: selected,
    redactionSummary: {
      policy: 'weekly_planning_trace_admin_redaction_v1',
      sensitiveIdentityFieldsRemoved: true,
      secretFieldsRemoved: true,
      textPatternRedactionApplied: true,
    },
    truncationSummary: {
      availableEntryCount: selected.length,
      includedEntryCount: selected.length,
      omittedEntryCount: 0,
      entryLimit: 200,
      scanLimit: 200,
      scanLimitReached: false,
      byteLimit: 524288,
      byteLimitReached: false,
    },
  };
}
