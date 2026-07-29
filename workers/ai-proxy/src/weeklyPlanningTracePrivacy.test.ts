import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_POLICY_VERSION,
  createWeeklyPlanningTraceSubject,
  isWeeklyPlanningTracePlanningRangeBoundary,
  isWeeklyPlanningTracePolicyAccepted,
  parseWeeklyPlanningTraceHmacSecrets,
  prepareWeeklyPlanningTraceServerWrite,
  prepareWeeklyPlanningTraceWrite,
  redactWeeklyPlanningTraceValue,
  resolveWeeklyPlanningTraceEpoch,
  traceSubjectEpochsForDeletion,
  weeklyPlanningTraceExpireAt,
} from './weeklyPlanningTracePrivacy';

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

const SESSION_ID = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';
const CONVERSATION_ID = 'weekly-conversation-323e4567-e89b-12d3-a456-426614174000';
const OCCURRED_AT = '2026-07-18T00:00:00.000Z';

function validSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SESSION_ID,
    logicalConversationId: CONVERSATION_ID,
    userId: 'firebase-user-123',
    status: 'active',
    startedAt: OCCURRED_AT,
    lastActivityAt: OCCURRED_AT,
    turnCount: 1,
    entryCount: 1,
    hasPreview: false,
    hasApprovalFailure: false,
    hasFallback: false,
    hasError: false,
    appVersion: 'test',
    schemaVersion: 2,
    ...overrides,
  };
}

function validLegacyTurnEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `${SESSION_ID}-00000000`,
    sessionId: SESSION_ID,
    logicalConversationId: CONVERSATION_ID,
    userId: 'firebase-user-123',
    sequence: 0,
    occurredAt: OCCURRED_AT,
    observedAt: OCCURRED_AT,
    schemaVersion: 1,
    kind: 'turn',
    role: 'user',
    content: 'hello',
    turnIndex: 0,
    ...overrides,
  };
}

function validDiagnosticEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `${SESSION_ID}-00000000`,
    sessionId: SESSION_ID,
    logicalConversationId: CONVERSATION_ID,
    userId: 'firebase-user-123',
    sequence: 0,
    requestId: 'request-1',
    occurredAt: OCCURRED_AT,
    observedAt: OCCURRED_AT,
    schemaVersion: 2,
    kind: 'turn_diagnostic',
    traceSchema: 'weekly-planning-turn-diagnostic-v2',
    turnIndex: 0,
    userInput: { text: '来週、英語を3時間やりたい person@example.com' },
    aiInterpreter: {
      provider: 'openai',
      model: 'gpt-test',
      promptVersion: 'v5',
      input: {
        userText: '来週、英語を3時間やりたい person@example.com',
        conversationContext: [],
        planningStateSummary: { taskCount: 0 },
        requests: [{
          attempt: 'initial',
          messages: [{ role: 'user', content: 'actual prompt' }],
          purpose: 'weekly_planning_semantic_normalizer',
          responseFormat: { type: 'json_schema' },
          maxCompletionTokens: 3200,
          requestBytes: 100,
        }],
      },
      rawResponses: [{ attempt: 'initial', text: '{"tasks":[]}' }],
      structuredResults: [{
        attempt: 'initial',
        accepted: true,
        errors: [],
        structuredResult: { tasks: [] },
      }],
      candidateOperations: [],
      error: null,
    },
    parsers: [{
      parser: 'planning_range',
      inputText: '来週、英語を3時間やりたい',
      matchedText: '来週',
      candidateOperation: { operation: 'set_planning_window' },
      accepted: true,
      reason: null,
    }],
    decision: {
      status: 'accepted',
      acceptedOperations: [{ operation: 'set_planning_window' }],
      rejectedOperations: [],
      finalOperations: [{ operation: 'set_planning_window' }],
      precedence: 'semantic_canonicalizer',
      reason: null,
      stateDiff: [{ operation: 'set_planning_window' }],
    },
    constraintContext: {
      existingPlanCount: 500,
      scheduleTemplateCount: 20,
      relevantBusyIntervals: [],
    },
    assistantOutput: {
      text: '条件を整理しました。',
      responseSource: 'ai',
    },
    diagnostics: {
      durationMs: 100,
      fallback: null,
      error: null,
      outcome: 'revision_pending',
      previewCount: 0,
      stale: false,
    },
    ...overrides,
  };
}

describe('weekly planning trace privacy boundary', () => {
  it('rotates the subject token by epoch without exposing the uid', async () => {
    const secrets = {
      '100': 'a'.repeat(32),
      '101': 'b'.repeat(32),
    };
    const first = await createWeeklyPlanningTraceSubject('firebase-user-123', '100', secrets);
    const same = await createWeeklyPlanningTraceSubject('firebase-user-123', '100', secrets);
    const rotated = await createWeeklyPlanningTraceSubject('firebase-user-123', '101', secrets);

    expect(first).toEqual(same);
    expect(first.token).toMatch(/^wpt_[A-Za-z0-9_-]+$/);
    expect(first.token).not.toContain('firebase-user-123');
    expect(rotated.token).not.toBe(first.token);
  });

  it('accepts only well-formed secret rings and lists every retained epoch', () => {
    const ring = parseWeeklyPlanningTraceHmacSecrets(JSON.stringify({
      '100': 'a'.repeat(32),
      '101': 'b'.repeat(48),
      invalid: 'c'.repeat(48),
    }));

    expect(traceSubjectEpochsForDeletion(ring)).toEqual(['100', '101']);
    expect(() => parseWeeklyPlanningTraceHmacSecrets('{bad')).toThrow(/invalid JSON/);
    expect(() => parseWeeklyPlanningTraceHmacSecrets(JSON.stringify({ '100': 'short' })))
      .toThrow(/no valid epoch secret/);
  });

  it('uses epochs no longer than thirty days and assigns a 180 day expiry', () => {
    const epochMs = 30 * 24 * 60 * 60 * 1000;
    const reference = new Date('2026-07-18T00:00:00.000Z');
    const epochStart = new Date(Math.floor(reference.getTime() / epochMs) * epochMs);
    const beforeRotation = new Date(epochStart.getTime() + 29 * 24 * 60 * 60 * 1000);
    const afterRotation = new Date(epochStart.getTime() + 30 * 24 * 60 * 60 * 1000);

    expect(resolveWeeklyPlanningTraceEpoch(epochStart))
      .toBe(resolveWeeklyPlanningTraceEpoch(beforeRotation));
    expect(resolveWeeklyPlanningTraceEpoch(epochStart))
      .not.toBe(resolveWeeklyPlanningTraceEpoch(afterRotation));
    expect(weeklyPlanningTraceExpireAt(reference)).toBe('2027-01-14T00:00:00.000Z');
  });

  it('keeps recursive redaction only for legacy documents', () => {
    const redacted = redactWeeklyPlanningTraceValue({
      userId: 'raw-user',
      traceSubjectToken: 'wpt_internal-token',
      nested: {
        email: 'person@example.com',
        content: '連絡先は person@example.com / 090-1234-5678 https://example.com/path?token=secret',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      },
    });
    const output = serialized(redacted);

    expect(output).not.toContain('raw-user');
    expect(output).not.toContain('person@example.com');
    expect(output).not.toContain('090-1234-5678');
    expect(output).not.toContain('token=secret');
    expect(output).toContain('[EMAIL]');
    expect(output).toContain('[PHONE]');
  });

  it('stores schema v2 diagnostic text as supplied while dropping account identity', async () => {
    const subject = await createWeeklyPlanningTraceSubject(
      'firebase-user-123',
      '100',
      { '100': 'a'.repeat(32) },
    );
    const prepared = prepareWeeklyPlanningTraceWrite({
      session: validSession(),
      entries: [validDiagnosticEntry()],
    }, subject, OCCURRED_AT);
    const output = serialized(prepared);

    expect(output).not.toContain('firebase-user-123');
    expect(output).toContain('person@example.com');
    expect(prepared.entries).toHaveLength(1);
    expect(prepared.entries[0].kind).toBe('turn_diagnostic');
    expect(prepared.entries[0].traceSubjectToken).toBe(subject.token);
    expect(prepared.entries[0].traceSubjectEpoch).toBe('100');
    expect(prepared.entries[0].policyVersion).toBe(WEEKLY_PLANNING_TRACE_POLICY_VERSION);
  });

  it('rejects full application state and chunk metadata in a schema v2 diagnostic', () => {
    const forbidden = [
      { runtime: { plans: [{ id: 'plan-1' }] } },
      { plans: [{ id: 'plan-1' }] },
      { scheduleTemplates: [{ id: 'template-1' }] },
      { dataChunk: 'abc' },
      { chunkIndex: 0 },
      { chunkCount: 1 },
      { chunkBytes: 100 },
      { totalSerializedBytes: 100 },
      { debugSequence: 1 },
      { debugSchemaVersion: 1 },
      { nested: { userId: 'raw-user' } },
    ];

    forbidden.forEach((value) => {
      expect(() => prepareWeeklyPlanningTraceServerWrite({
        session: validSession(),
        entries: [validDiagnosticEntry({
          diagnostics: {
            durationMs: 100,
            fallback: null,
            error: null,
            outcome: 'revision_pending',
            previewCount: 0,
            stale: false,
            ...value,
          },
        })],
      }, { token: 'wpt_token', epoch: '100' }, {
        sessionId: SESSION_ID,
        logicalConversationId: CONVERSATION_ID,
      }, OCCURRED_AT)).toThrow(/turn diagnostic entry schema/);
    });
  });

  it('does not multiply one diagnostic into physical chunk entries', () => {
    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: validSession({ entryCount: 1, turnCount: 1 }),
      entries: [validDiagnosticEntry()],
    }, { token: 'wpt_token', epoch: '100' }, {
      sessionId: SESSION_ID,
      logicalConversationId: CONVERSATION_ID,
    }, OCCURRED_AT);

    expect(prepared.entries).toHaveLength(1);
    expect(prepared.session.entryCount).toBe(1);
    expect(serialized(prepared)).not.toContain('base64_utf8_json_chunk');
    expect(serialized(prepared)).not.toContain('dataChunk');
  });

  it.each([
    '2026-07-21',
    '2026-07-21T09:00:00',
    '2026-07-21T09:00:00.000',
    '2026-07-27T24:00:00',
    '2026-07-27T24:00:00.000',
    '2026-07-21T00:00:00.000Z',
  ])('accepts the planning range boundary %s', (value) => {
    expect(isWeeklyPlanningTracePlanningRangeBoundary(value)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2026-07-21T24:00:01',
    '2026-07-21T24:00:00.001',
    '2026-07-21T25:00:00',
    '2026-07-21T09:60:00',
    '2026-07-21T09:00',
    'not-a-date',
  ])('rejects the invalid planning range boundary %s', (value) => {
    expect(isWeeklyPlanningTracePlanningRangeBoundary(value)).toBe(false);
  });

  it('retains read-only compatibility for a legacy turn write', () => {
    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: validSession({ schemaVersion: 1 }),
      entries: [validLegacyTurnEntry()],
    }, { token: 'wpt_token', epoch: '100' }, {
      sessionId: SESSION_ID,
      logicalConversationId: CONVERSATION_ID,
    }, OCCURRED_AT);

    expect(prepared.entries[0]).toMatchObject({
      kind: 'turn',
      content: 'hello',
    });
  });

  it('accepts production date-only and 24:00 range values at the server write boundary', () => {
    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: validSession({
        planningRangeStart: '2026-07-21',
        planningRangeEnd: '2026-07-27T24:00:00',
      }),
      entries: [validDiagnosticEntry()],
    }, { token: 'wpt_token', epoch: '100' }, {
      sessionId: SESSION_ID,
      logicalConversationId: CONVERSATION_ID,
    }, OCCURRED_AT);

    expect(prepared.session).toMatchObject({
      planningRangeStart: '2026-07-21',
      planningRangeEnd: '2026-07-27T24:00:00',
    });
  });

  it('keeps audit timestamps strict even though planning range boundaries are domain values', () => {
    expect(() => prepareWeeklyPlanningTraceServerWrite({
      session: validSession({
        startedAt: '2026-07-21T09:00:00',
        planningRangeStart: '2026-07-21T09:00:00',
      }),
      entries: [validDiagnosticEntry()],
    }, { token: 'wpt_token', epoch: '100' }, {
      sessionId: SESSION_ID,
      logicalConversationId: CONVERSATION_ID,
    })).toThrow(/session schema/);
  });

  it('requires matching entry ownership and the current policy version', () => {
    expect(() => prepareWeeklyPlanningTraceWrite({
      session: validSession(),
      entries: [validDiagnosticEntry({
        sessionId: 'weekly-trace-223e4567-e89b-12d3-a456-426614174000',
      })],
    }, { token: 'wpt_token', epoch: '100' })).toThrow(/session mismatch/);

    expect(isWeeklyPlanningTracePolicyAccepted({
      version: WEEKLY_PLANNING_TRACE_POLICY_VERSION,
      acceptedAt: OCCURRED_AT,
    })).toBe(true);
    expect(isWeeklyPlanningTracePolicyAccepted({
      version: 'old',
      acceptedAt: OCCURRED_AT,
    })).toBe(false);
  });

  it('rejects missing or invalid session and diagnostic schemas', () => {
    expect(() => prepareWeeklyPlanningTraceWrite({
      session: validSession({ status: 'unknown' }),
      entries: [validDiagnosticEntry()],
    }, { token: 'wpt_token', epoch: '100' })).toThrow(/session schema/);
    expect(() => prepareWeeklyPlanningTraceWrite({
      session: validSession(),
      entries: [validDiagnosticEntry({ userInput: { text: 123 } })],
    }, { token: 'wpt_token', epoch: '100' })).toThrow(/turn diagnostic entry schema/);
  });
});
