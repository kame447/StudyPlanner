import { beforeEach, describe, expect, it } from 'vitest';
import {
  finalizeStagedUserPlanningContextV1,
  loadUserPlanningContextSnapshotV1,
  resetUserPlanningContextRuntimeForTestV1,
  stageUserPlanningContextFactsV1,
  userPlanningContextPromptSummaryV1,
} from './userPlanningContextSpace';

describe('user planning context learning preferences', () => {
  beforeEach(() => {
    resetUserPlanningContextRuntimeForTestV1();
  });

  it('keeps an explicitly durable learning preference active across later weeks', () => {
    stageUserPlanningContextFactsV1({
      ownerId: 'owner-learning-preference',
      conversationId: 'conversation-1',
      requestId: 'turn-1',
      observedDate: '2026-08-17',
      now: '2026-08-17T09:00:00.000Z',
      facts: [{
        localId: 'preference-1',
        kind: 'learning_preference',
        label: '暗記学習の1回の長さ',
        value: '20分前後を基本にする',
        dateExpression: null,
        sourceText: '暗記系は今後も1回20分くらいを基本にしたい',
      }],
    });
    finalizeStagedUserPlanningContextV1({
      ownerId: 'owner-learning-preference',
      conversationId: 'conversation-1',
      requestId: 'turn-1',
    });

    const later = loadUserPlanningContextSnapshotV1({
      ownerId: 'owner-learning-preference',
      currentDate: '2026-10-01',
    });
    expect(later.records).toHaveLength(1);
    expect(later.records[0]).toMatchObject({
      kind: 'learning_preference',
      label: '暗記学習の1回の長さ',
      value: '20分前後を基本にする',
      dateExpression: null,
      resolvedDate: null,
      status: 'active',
    });
    expect(userPlanningContextPromptSummaryV1({
      ownerId: 'owner-learning-preference',
      currentDate: '2026-10-01',
    })).toEqual([
      expect.objectContaining({
        kind: 'learning_preference',
        value: '20分前後を基本にする',
        status: 'active',
      }),
    ]);
  });

  it('does not create long-term state unless a durable semantic fact is explicitly staged', () => {
    expect(loadUserPlanningContextSnapshotV1({
      ownerId: 'owner-week-only-choice',
      currentDate: '2026-08-17',
    }).records).toEqual([]);
  });
});
