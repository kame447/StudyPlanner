import { beforeEach, describe, expect, it } from 'vitest';
import {
  exportUserPlanningContextSnapshotV1,
  finalizeStagedUserPlanningContextV1,
  resetUserPlanningContextRuntimeForTestV1,
  stageUserPlanningContextFactsV1,
} from './userPlanningContextSpace';

const ownerId = 'concern-history-owner';

function commit(requestId: string, value: string, sourceText: string, now: string): void {
  stageUserPlanningContextFactsV1({
    ownerId,
    conversationId: 'conversation-1',
    requestId,
    observedDate: '2026-08-07',
    now,
    facts: [{
      localId: `local-${requestId}`,
      kind: 'concern',
      label: '対象分野',
      value,
      dateExpression: null,
      sourceText,
    }],
  });
  finalizeStagedUserPlanningContextV1({ ownerId, conversationId: 'conversation-1', requestId });
}

describe('UserPlanningContext concern history identity', () => {
  beforeEach(() => resetUserPlanningContextRuntimeForTestV1());

  it('preserves different concern values for the same entity instead of overwriting history', () => {
    commit('turn-1', '理解に不安がある', 'この分野は理解に不安があります', '2026-08-07T01:00:00.000Z');
    commit('turn-2', '演習で迷いやすい', 'この分野は演習で迷いやすいです', '2026-08-07T02:00:00.000Z');

    const records = exportUserPlanningContextSnapshotV1({ ownerId, currentDate: '2026-08-07' }).records;
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.value)).toEqual(expect.arrayContaining([
      '理解に不安がある',
      '演習で迷いやすい',
    ]));
    expect(records.find((record) => record.value === '理解に不安がある')?.sourceTurnId).toBe('turn-1');
  });

  it('keeps one identity for an exact repeated concern value', () => {
    commit('turn-1', '理解に不安がある', 'この分野は理解に不安があります', '2026-08-07T01:00:00.000Z');
    commit('turn-2', '理解に不安がある', '今もこの分野は理解に不安があります', '2026-08-07T02:00:00.000Z');

    const records = exportUserPlanningContextSnapshotV1({ ownerId, currentDate: '2026-08-07' }).records;
    expect(records).toHaveLength(1);
  });
});
