import { describe, expect, it } from 'vitest';
import {
  createObservabilityDebugBundleFromTrace,
  createObservabilityLogEntryProjection,
  createObservabilityLogSessionSummary,
  projectObservabilityLogSessionPage,
} from './productObservabilityWeeklyPlanningDiagnosticAdapter';

const sessionId = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';
const subjectToken = 'wpt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    traceSubjectToken: subjectToken,
    traceSubjectEpoch: '99',
    status: 'failed',
    startedAt: '2026-08-30T10:00:00.000Z',
    lastActivityAt: '2026-08-30T10:05:00.000Z',
    entryCount: 2,
    turnCount: 1,
    hasPreview: true,
    hasApprovalFailure: false,
    hasFallback: true,
    hasError: true,
    appVersion: '2026.8.30',
    schemaVersion: 2,
    ...overrides,
  };
}

function diagnosticEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: `${sessionId}-00000000`,
    sessionId,
    traceSubjectToken: subjectToken,
    userId: 'raw-firebase-uid',
    sequence: 0,
    kind: 'turn_diagnostic',
    schemaVersion: 2,
    occurredAt: '2026-08-30T10:01:00.000Z',
    observedAt: '2026-08-30T10:01:01.000Z',
    requestId: 'request-123',
    stateRevision: 4,
    turnIndex: 1,
    userInput: { text: 'mail me at secret@example.com' },
    aiInterpreter: {
      model: 'gpt-5.6-luna',
      promptVersion: 'stable-v5-p7',
      rawResponses: [{ text: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' }],
    },
    decision: { status: 'rejected', stateDiff: { authorization: 'secret-token' } },
    constraintContext: {
      scheduler: { preview: { schedulerVersion: 'stable-v5' } },
    },
    diagnostics: {
      outcome: 'failed',
      error: { type: 'ValidationError', message: 'bad request' },
      fallback: 'deterministic',
      stale: false,
    },
    ...overrides,
  };
}

describe('Phase 7 weekly-planning diagnostic adapter projections', () => {
  it.each([
    [{ entryCount: 0, turnCount: 0 }, 'no_indexed_entries'],
    [{ entryCount: 0, turnCount: 3 }, 'activity_without_indexed_entries'],
    [{ entryCount: 0, turnCount: 0, hasError: true }, 'activity_without_indexed_entries'],
    [{ entryCount: 2, turnCount: 1 }, 'indexed_activity'],
    [{ entryCount: undefined }, 'unknown_or_invalid_metadata'],
    [{ entryCount: -1 }, 'unknown_or_invalid_metadata'],
    [{ entryCount: '2' }, 'unknown_or_invalid_metadata'],
    [{ turnCount: Number.NaN }, 'unknown_or_invalid_metadata'],
    [{ startedAt: 'not-a-date' }, 'unknown_or_invalid_metadata'],
    [{ status: 'unsupported-state' }, 'unknown_or_invalid_metadata'],
  ])('does not normalize metadata evidence into an assertion of stored trace content: %j', (overrides, expected) => {
    const mapped = createObservabilityLogSessionSummary(session({
      hasPreview: false, hasFallback: false, hasError: false, hasApprovalFailure: false,
      ...overrides,
    }));
    expect(mapped?.metadataEvidence).toBe(expected);
    expect(mapped?.summary).not.toBe('diagnostic trace available');
  });

  it('separates unreadable documents from status filtering within the fetched page', () => {
    const page = projectObservabilityLogSessionPage([
      session({ status: 'active' }),
      session({ id: 'other-session', status: 'completed' }),
      session({ startedAt: null }),
    ], 'active');
    expect(page.sessions).toHaveLength(1);
    expect(page.pageEvidence).toEqual({
      rawDocumentCount: 3, mappedSessionCount: 2,
      unreadableSessionCount: 1, statusFilteredCount: 1,
    });
    expect(JSON.stringify(page)).not.toContain(subjectToken);
  });

  it('maps a trace session without exposing raw subject identity', () => {
    const mapped = createObservabilityLogSessionSummary(session());
    expect(mapped?.traceSessionId).toBe(sessionId);
    expect(mapped?.subjectAlias).toMatch(/^subject-/);
    expect(JSON.stringify(mapped)).not.toContain(subjectToken);
    expect(JSON.stringify(mapped)).not.toContain('raw-firebase-uid');
  });

  it('keeps list summaries content-free and redacts expanded detail', () => {
    const mapped = createObservabilityLogEntryProjection(diagnosticEntry());
    expect(mapped?.summary).toBe('turn 1 · failed');
    expect(mapped?.summary).not.toContain('secret@example.com');
    const serialized = JSON.stringify(mapped?.detail);
    expect(serialized).not.toContain('secret@example.com');
    expect(serialized).not.toContain(subjectToken);
    expect(serialized).not.toContain('raw-firebase-uid');
    expect(serialized).not.toContain('secret-token');
  });

  it('creates a stable versioned request-scoped debug bundle with explicit redaction metadata', () => {
    const bundle = createObservabilityDebugBundleFromTrace({
      session: session(),
      entries: [
        diagnosticEntry(),
        diagnosticEntry({
          id: `${sessionId}-00000001`,
          sequence: 1,
          requestId: 'request-other',
        }),
      ],
      totalEntryCount: 1,
      requestId: 'request-123',
      generatedAt: '2026-08-30T11:00:00.000Z',
    });
    expect(bundle.schema).toBe('studyplanner-debug-bundle');
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.correlation.requestIds).toEqual(['request-123']);
    expect(bundle.versions.models).toEqual(['gpt-5.6-luna']);
    expect(bundle.versions.promptVersions).toEqual(['stable-v5-p7']);
    expect(bundle.versions.schedulerVersions).toEqual(['stable-v5']);
    expect(bundle.redactionSummary.secretFieldsRemoved).toBe(true);
    expect(bundle.truncationSummary.omittedEntryCount).toBe(0);
    expect(JSON.stringify(bundle)).not.toContain('secret@example.com');
    expect(JSON.stringify(bundle)).not.toContain(subjectToken);
  });
});
