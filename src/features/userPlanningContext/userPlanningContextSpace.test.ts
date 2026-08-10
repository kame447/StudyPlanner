import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearUserPlanningContextForOwnerV1,
  discardStagedUserPlanningContextV1,
  exportUserPlanningContextSnapshotV1,
  finalizeStagedUserPlanningContextV1,
  hasStagedUserPlanningContextV1,
  resetUserPlanningContextRuntimeForTestV1,
  rollbackFinalizedUserPlanningContextV1,
  stageUserPlanningContextFactsV1,
  userPlanningContextPromptSummaryV1,
} from './userPlanningContextSpace';

const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';

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
      }),
      expect.objectContaining({
        kind: 'concern',
        label: '数学',
        value: '学習上の不安・優先度が高い',
        resolvedDate: null,
      }),
    ]));
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

  it('marks resolved past events historical while retaining them in history', () => {
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
      status: 'historical',
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
});
