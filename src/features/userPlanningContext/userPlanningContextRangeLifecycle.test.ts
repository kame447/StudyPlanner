import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearUserPlanningContextForOwnerV1,
  exportUserPlanningContextSnapshotV1,
  finalizeStagedUserPlanningContextV1,
  resetUserPlanningContextRuntimeForTestV1,
  stageUserPlanningContextFactsV1,
  userPlanningContextPromptSummaryV1,
} from './userPlanningContextSpace';

const OWNER = 'range-lifecycle-owner';

beforeEach(() => {
  resetUserPlanningContextRuntimeForTestV1();
  clearUserPlanningContextForOwnerV1(OWNER);
});

describe('durable goal-event range lifecycle', () => {
  it('keeps a month-level event active through the represented period and marks it for review afterwards', () => {
    stageUserPlanningContextFactsV1({
      ownerId: OWNER,
      conversationId: 'conversation-1',
      requestId: 'request-1',
      observedDate: '2026-08-28',
      now: '2026-08-28T00:00:00.000Z',
      facts: [{
        localId: 'common-test',
        kind: 'goal_event',
        label: '共通テスト',
        value: null,
        dateExpression: '2027-01-01/2027-01-31',
        sourceText: '共通テストは2027年1月です',
      }],
    });
    finalizeStagedUserPlanningContextV1({
      ownerId: OWNER,
      conversationId: 'conversation-1',
      requestId: 'request-1',
    });

    expect(exportUserPlanningContextSnapshotV1({
      ownerId: OWNER,
      currentDate: '2027-01-15',
    }).records[0]).toMatchObject({
      dateExpression: '2027-01-01/2027-01-31',
      resolvedDate: '2027-01-31',
      status: 'active',
    });

    expect(exportUserPlanningContextSnapshotV1({
      ownerId: OWNER,
      currentDate: '2027-02-01',
    }).records[0]).toMatchObject({
      resolvedDate: '2027-01-31',
      status: 'needs_review',
    });
    expect(userPlanningContextPromptSummaryV1({
      ownerId: OWNER,
      currentDate: '2027-02-01',
    })).toEqual([]);
  });
});
