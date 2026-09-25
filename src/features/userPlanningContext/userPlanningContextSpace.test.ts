import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearUserPlanningContextForOwnerV1,
  discardStagedUserPlanningContextV1,
  exportUserPlanningContextSnapshotV1,
  finalizeStagedUserPlanningContextV1,
  hasStagedUserPlanningContextV1,
  hydrateUserPlanningContextSnapshotV1,
  resetUserPlanningContextRuntimeForTestV1,
  rollbackFinalizedUserPlanningContextV1,
  stageUserPlanningContextFactsV1,
  userPlanningContextDurableKeyV1,
  userPlanningContextPromptSummaryV1,
} from './userPlanningContextSpace';
import {
  createEmptyUserPlanningContextSnapshotV1,
  type UserPlanningContextRecordV1,
} from './userPlanningContextTypes';

const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';

function storedRecord(overrides: Partial<UserPlanningContextRecordV1> = {}): UserPlanningContextRecordV1 {
  return {
    id: 'stored-1',
    ownerId: OWNER_A,
    kind: 'concern',
    label: '数学',
    value: '苦手',
    dateExpression: null,
    observedDate: '2026-08-07',
    resolvedDate: null,
    sourceText: '数学が苦手です',
    sourceConversationId: 'older-conversation',
    sourceTurnId: 'older-turn',
    recordedAt: '2026-08-07T08:00:00.000Z',
    status: 'active',
    origin: 'user_stated',
    ...overrides,
  };
}

beforeEach(() => {
  resetUserPlanningContextRuntimeForTestV1();
  clearUserPlanningContextForOwnerV1(OWNER_A);
  clearUserPlanningContextForOwnerV1(OWNER_B);
});

describe('UserPlanningContextSpace', () => {
  it('stages goal events and concerns and commits them only on finalize', () => {
    stageUserPlanningContextFactsV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-1',
      requestId: 'request-2',
      observedDate: '2026-08-07',
      now: '2026-08-07T08:00:00.000Z',
      facts: [
        {
          localId: 'context-event-1',
          kind: 'goal_event',
          label: '共通テスト模試',
          value: null,
          dateExpression: 'custom:2週間後',
          sourceText: '2週間後に共通テスト模試もあるので',
        },
        {
          localId: 'context-concern-1',
          kind: 'concern',
          label: '数学',
          value: '学習上の不安・優先度が高い',
          dateExpression: null,
          sourceText: '特に数学が結構まずいです',
        },
      ],
    });

    expect(hasStagedUserPlanningContextV1({
      conversationId: 'conversation-1',
      requestId: 'request-2',
    })).toBe(true);
    expect(exportUserPlanningContextSnapshotV1({
      ownerId: OWNER_A,
      currentDate: '2026-08-07',
    }).records).toEqual([]);

    finalizeStagedUserPlanningContextV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-1',
      requestId: 'request-2',
    });

    const snapshot = exportUserPlanningContextSnapshotV1({
      ownerId: OWNER_A,
      currentDate: '2026-08-07',
    });
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'goal_event',
        label: '共通テスト模試',
        observedDate: '2026-08-07',
        resolvedDate: '2026-08-21',
        status: 'active',
        origin: 'user_stated',
      }),
      expect.objectContaining({
        kind: 'concern',
        label: '数学',
        value: '学習上の不安・優先度が高い',
        resolvedDate: null,
        origin: 'user_stated',
      }),
    ]));
  });

  it('keeps a study goal active across plans and replaces the same goal label when it changes', () => {
    stageUserPlanningContextFactsV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-1',
      requestId: 'goal-1',
      observedDate: '2026-08-07',
      now: '2026-08-07T08:00:00.000Z',
      facts: [{
        localId: 'goal-1',
        kind: 'study_goal',
        label: '第一志望',
        value: '国公立大学の理系',
        dateExpression: null,
        sourceText: '国公立大学の理系を志望しています',
      }],
    });
    finalizeStagedUserPlanningContextV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-1',
      requestId: 'goal-1',
    });

    stageUserPlanningContextFactsV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-2',
      requestId: 'goal-2',
      observedDate: '2026-10-01',
      now: '2026-10-01T08:00:00.000Z',
      facts: [{
        localId: 'goal-2',
        kind: 'study_goal',
        label: '第一志望',
        value: '静岡大学情報学部',
        dateExpression: null,
        sourceText: '第一志望は静岡大学情報学部です',
      }],
    });
    finalizeStagedUserPlanningContextV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-2',
      requestId: 'goal-2',
    });

    const active = userPlanningContextPromptSummaryV1({
      ownerId: OWNER_A,
      currentDate: '2026-12-01',
    });
    expect(active).toEqual([
      expect.objectContaining({
        kind: 'study_goal',
        label: '第一志望',
        value: '静岡大学情報学部',
        status: 'active',
        origin: 'user_stated',
      }),
    ]);
  });

  it('does not persist discarded turn context', () => {
    stageUserPlanningContextFactsV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-1',
      requestId: 'request-1',
      observedDate: '2026-08-07',
      facts: [{
        localId: 'context-1',
        kind: 'concern',
        label: '数学',
        value: '不安',
        dateExpression: null,
        sourceText: '数学が不安です',
      }],
    });
    discardStagedUserPlanningContextV1({
      conversationId: 'conversation-1',
      requestId: 'request-1',
    });
    expect(exportUserPlanningContextSnapshotV1({
      ownerId: OWNER_A,
      currentDate: '2026-08-07',
    }).records).toEqual([]);
  });

  it('keeps owner contexts isolated', () => {
    stageUserPlanningContextFactsV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-a',
      requestId: 'request-a',
      observedDate: '2026-08-07',
      facts: [{
        localId: 'context-a',
        kind: 'concern',
        label: '数学',
        value: '優先',
        dateExpression: null,
        sourceText: '数学を優先したい',
      }],
    });
    finalizeStagedUserPlanningContextV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-a',
      requestId: 'request-a',
    });

    expect(userPlanningContextPromptSummaryV1({
      ownerId: OWNER_B,
      currentDate: '2026-08-07',
    })).toEqual([]);
  });

  it('moves expired goal events to needs-review instead of treating the goal outcome as known history', () => {
    stageUserPlanningContextFactsV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-a',
      requestId: 'request-a',
      observedDate: '2026-08-07',
      facts: [{
        localId: 'event-a',
        kind: 'goal_event',
        label: '模試',
        value: null,
        dateExpression: '2026-08-10',
        sourceText: '8月10日に模試があります',
      }],
    });
    finalizeStagedUserPlanningContextV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-a',
      requestId: 'request-a',
    });

    const snapshot = exportUserPlanningContextSnapshotV1({
      ownerId: OWNER_A,
      currentDate: '2026-08-11',
    });
    expect(snapshot.records[0]).toMatchObject({
      label: '模試',
      status: 'needs_review',
    });
    expect(userPlanningContextPromptSummaryV1({
      ownerId: OWNER_A,
      currentDate: '2026-08-11',
    })).toEqual([]);
  });

  it('can roll back a finalized context if the paired weekly graph commit fails', () => {
    stageUserPlanningContextFactsV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-a',
      requestId: 'request-a',
      observedDate: '2026-08-07',
      facts: [{
        localId: 'context-a',
        kind: 'concern',
        label: '数学',
        value: '優先',
        dateExpression: null,
        sourceText: '数学を優先したい',
      }],
    });
    const receipt = finalizeStagedUserPlanningContextV1({
      ownerId: OWNER_A,
      conversationId: 'conversation-a',
      requestId: 'request-a',
    });
    expect(exportUserPlanningContextSnapshotV1({
      ownerId: OWNER_A,
      currentDate: '2026-08-07',
    }).records).toHaveLength(1);

    rollbackFinalizedUserPlanningContextV1(receipt);
    expect(exportUserPlanningContextSnapshotV1({
      ownerId: OWNER_A,
      currentDate: '2026-08-07',
    }).records).toEqual([]);
  });

  it('reads a legacy invisible-character tombstone in a new session and still saves unrelated facts', () => {
    hydrateUserPlanningContextSnapshotV1({
      ...createEmptyUserPlanningContextSnapshotV1(OWNER_A),
      records: [storedRecord({
        id: 'forgotten-math',
        label: '数\u200B学',
        recordedAt: '2026-08-08T08:00:00.000Z',
        status: 'revoked',
        origin: 'user_confirmed',
      })],
      updatedAt: '2026-08-08T08:00:00.000Z',
    });
    const persisted = exportUserPlanningContextSnapshotV1({ ownerId: OWNER_A, currentDate: '2026-08-08' });
    resetUserPlanningContextRuntimeForTestV1();
    hydrateUserPlanningContextSnapshotV1(JSON.parse(JSON.stringify(persisted)));

    stageUserPlanningContextFactsV1({
      ownerId: OWNER_A,
      conversationId: 'new-conversation',
      requestId: 'new-turn',
      observedDate: '2026-08-09',
      now: '2026-08-09T08:00:00.000Z',
      facts: [
        {
          localId: 'old-key-variant',
          kind: 'concern',
          label: '数学',
          value: '苦手',
          dateExpression: null,
          sourceText: '数学が苦手です',
        },
        {
          localId: 'ordinary-different-label',
          kind: 'concern',
          label: '物理',
          value: '苦手',
          dateExpression: null,
          sourceText: '物理が苦手です',
        },
      ],
    });
    finalizeStagedUserPlanningContextV1({
      ownerId: OWNER_A,
      conversationId: 'new-conversation',
      requestId: 'new-turn',
    });

    const records = exportUserPlanningContextSnapshotV1({ ownerId: OWNER_A, currentDate: '2026-08-09' }).records;
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.id === 'forgotten-math')).toMatchObject({
      label: '数\u200B学',
      status: 'revoked',
    });
    expect(records.find((record) => record.label === '物理')).toMatchObject({ status: 'active' });
    expect(records.some((record) => record.label === '数学' && record.status === 'active')).toBe(false);
  });

  it('compares format and default-ignorable marks while keeping visibly different labels distinct', () => {
    const base = userPlanningContextDurableKeyV1({ kind: 'concern', label: '数学' });
    expect(userPlanningContextDurableKeyV1({ kind: 'concern', label: '数\u0600学' })).toBe(base);
    expect(userPlanningContextDurableKeyV1({ kind: 'concern', label: '数学\uFE0F' })).toBe(base);
    expect(userPlanningContextDurableKeyV1({ kind: 'concern', label: '物理' })).not.toBe(base);
  });

  it('does not overwrite newer local records when an older staged turn finalizes', () => {
    stageUserPlanningContextFactsV1({
      ownerId: OWNER_A,
      conversationId: 'older-conversation',
      requestId: 'older-turn',
      observedDate: '2026-08-07',
      now: '2026-08-07T10:00:00.000+02:00',
      facts: [{
        localId: 'concern-1',
        kind: 'concern',
        label: '数学',
        value: '苦手',
        dateExpression: null,
        sourceText: '数学が苦手です',
      }],
    });
    hydrateUserPlanningContextSnapshotV1({
      ...createEmptyUserPlanningContextSnapshotV1(OWNER_A),
      records: [storedRecord({
        id: 'newer-record',
        sourceConversationId: 'newer-conversation',
        sourceTurnId: 'newer-turn',
        recordedAt: '2026-08-07T09:00:00.000Z',
      })],
      updatedAt: '2026-08-07T09:00:00.000Z',
    });

    expect(finalizeStagedUserPlanningContextV1({
      ownerId: OWNER_A,
      conversationId: 'older-conversation',
      requestId: 'older-turn',
    })).toBeNull();
    expect(exportUserPlanningContextSnapshotV1({ ownerId: OWNER_A, currentDate: '2026-08-07' }).records)
      .toEqual([expect.objectContaining({ id: 'newer-record', sourceTurnId: 'newer-turn' })]);
  });
});
