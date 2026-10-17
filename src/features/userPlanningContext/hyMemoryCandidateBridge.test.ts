import { describe, expect, it } from 'vitest';
import { resolveHyMemoryCandidates } from './hyMemoryCandidateBridge';
import type { UserPlanningContextRecordV1 } from './userPlanningContextTypes';

function record(
  id: string,
  ownerId = 'owner-1',
  status: UserPlanningContextRecordV1['status'] = 'active',
): UserPlanningContextRecordV1 {
  return {
    id,
    ownerId,
    kind: 'learning_preference',
    label: `項目${id}`,
    value: `内容${id}`,
    dateExpression: null,
    observedDate: '2026-10-17',
    resolvedDate: null,
    sourceText: `原発話${id}`,
    sourceConversationId: 'conversation-1',
    sourceTurnId: `turn-${id}`,
    recordedAt: '2026-10-17T00:00:00.000Z',
    status,
    origin: 'user_confirmed',
  };
}

const records = [
  record('valid'),
  record('revoked', 'owner-1', 'revoked'),
  record('superseded', 'owner-1', 'superseded'),
  record('other-user', 'owner-2'),
];

describe('Hy Memory read-only candidate bridge', () => {
  it('uses only active authoritative records in the exact owner and revision', () => {
    const resolved = resolveHyMemoryCandidates({
      ownerId: 'owner-1',
      sourceRevision: 5,
      records,
      indexRead: {
        status: 'ready', ownerId: 'owner-1', sourceRevision: 5,
        recordIds: ['revoked', 'other-user', 'valid', 'superseded', 'valid', 'phantom'],
      },
    });
    expect(resolved).toEqual({ status: 'ready', records: [records[0]] });
  });

  it('distinguishes valid no-match from unavailable, stale, and wrong-owner results', () => {
    const base = { ownerId: 'owner-1', sourceRevision: 5, records };
    expect(resolveHyMemoryCandidates({
      ...base, indexRead: { status: 'ready', ownerId: 'owner-1', sourceRevision: 5, recordIds: [] },
    })).toEqual({ status: 'ready', records: [] });
    expect(resolveHyMemoryCandidates({
      ...base, indexRead: { status: 'unavailable' },
    }).status).toBe('unavailable');
    expect(resolveHyMemoryCandidates({
      ...base, indexRead: { status: 'ready', ownerId: 'owner-1', sourceRevision: 4, recordIds: ['valid'] },
    }).status).toBe('unavailable');
    expect(resolveHyMemoryCandidates({
      ...base, indexRead: { status: 'ready', ownerId: 'owner-2', sourceRevision: 5, recordIds: ['valid'] },
    }).status).toBe('unavailable');
  });

  it('bounds a valid result to ten records without accepting index text as truth', () => {
    const active = Array.from({ length: 25 }, (_, index) => record(`r${index}`));
    const result = resolveHyMemoryCandidates({
      ownerId: 'owner-1', sourceRevision: 6, records: active,
      indexRead: { status: 'ready', ownerId: 'owner-1', sourceRevision: 6, recordIds: active.map((r) => r.id) },
    });
    expect(result.status).toBe('ready');
    expect(result.records).toHaveLength(10);
    expect(result.records[0].value).toBe('内容r0');
  });
});
