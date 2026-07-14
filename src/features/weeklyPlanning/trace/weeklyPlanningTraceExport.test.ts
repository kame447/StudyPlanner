import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningEvaluationFixtureCandidate,
  createWeeklyPlanningRoleplayCandidate,
} from './weeklyPlanningTraceExport';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const session: WeeklyPlanningTraceSession = {
  id: 'session-1',
  logicalConversationId: 'conversation-1',
  userId: 'user-1',
  status: 'completed',
  startedAt: '2026-07-15T00:00:00.000Z',
  lastActivityAt: '2026-07-15T00:01:00.000Z',
  endedAt: '2026-07-15T00:01:00.000Z',
  turnCount: 2,
  entryCount: 5,
  hasPreview: true,
  hasApprovalFailure: false,
  hasFallback: false,
  hasError: false,
  appVersion: 'test',
  schemaVersion: 1,
  expireAt: '2026-10-13T00:00:00.000Z',
};

function baseEntry(sequence: number) {
  return {
    id: `session-1-${sequence}`,
    sessionId: 'session-1',
    logicalConversationId: 'conversation-1',
    userId: 'user-1',
    sequence,
    occurredAt: `2026-07-15T00:00:0${sequence}.000Z`,
    observedAt: `2026-07-15T00:00:0${sequence}.000Z`,
    schemaVersion: 1,
    expireAt: '2026-10-13T00:00:00.000Z',
  };
}

const entries: WeeklyPlanningTraceEntry[] = [
  {
    ...baseEntry(0),
    kind: 'turn',
    role: 'user',
    content: '連絡先は test@example.com、予定は https://example.com です',
    turnIndex: 0,
  },
  {
    ...baseEntry(1),
    kind: 'internal_event',
    eventType: 'interpreter_completed',
    payload: { acceptedCount: 1 },
    severity: 'info',
    stateRevision: 1,
  },
  {
    ...baseEntry(2),
    kind: 'internal_event',
    eventType: 'preview_generated',
    payload: { candidateCount: 2 },
    severity: 'info',
    stateRevision: 1,
  },
  {
    ...baseEntry(3),
    kind: 'internal_event',
    eventType: 'approval_completed',
    payload: { items: [{ status: 'skipped_duplicate' }] },
    severity: 'info',
    stateRevision: 1,
  },
  {
    ...baseEntry(4),
    kind: 'turn',
    role: 'assistant',
    content: '仮予定を作りました。',
    turnIndex: 1,
    stateRevision: 1,
  },
];

describe('weeklyPlanningTraceExport', () => {
  it('DA3c向けのstrict result候補を構築する', () => {
    const fixture = createWeeklyPlanningEvaluationFixtureCandidate(session, entries);

    expect(fixture.callCount).toBe(1);
    expect(fixture.strictResults.previewCompleted).toBe(true);
    expect(fixture.strictResults.duplicateSaveSuppressed).toBe(true);
    expect(fixture.turns).toHaveLength(2);
    expect(fixture.rubricInput.finalStateRevision).toBe(1);
  });

  it('roleplay候補のメールとURLをmaskし、人手確認必須にする', () => {
    const candidate = createWeeklyPlanningRoleplayCandidate(session, entries);

    expect(candidate.requiresHumanReview).toBe(true);
    expect(candidate.turns[0]?.content).toContain('[EMAIL]');
    expect(candidate.turns[0]?.content).toContain('[URL]');
  });
});
