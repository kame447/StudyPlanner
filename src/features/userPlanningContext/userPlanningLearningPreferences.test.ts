import { beforeEach, describe, expect, it } from 'vitest';
import {
  finalizeStagedUserPlanningContextV1,
  resetUserPlanningContextRuntimeForTestV1,
  stageUserPlanningContextFactsV1,
} from './userPlanningContextSpace';
import {
  loadDurableUserLearningPreferencesV1,
} from './userPlanningLearningPreferences';
import {
  USER_LEARNING_PREFERENCE_LABELS_V1,
} from './userPlanningContextTypes';

describe('durable user learning preferences', () => {
  beforeEach(() => {
    resetUserPlanningContextRuntimeForTestV1();
  });

  it('projects canonical long-term memorization preferences into typed settings', () => {
    stageUserPlanningContextFactsV1({
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      requestId: 'turn-1',
      observedDate: '2026-08-17',
      now: '2026-08-17T09:00:00.000Z',
      facts: [
        {
          localId: 'duration',
          kind: 'learning_preference',
          label: USER_LEARNING_PREFERENCE_LABELS_V1.memorizationSessionDurationMinutes,
          value: '20',
          dateExpression: null,
          sourceText: '暗記は今後も1回20分くらいがいい',
        },
        {
          localId: 'spacing',
          kind: 'learning_preference',
          label: USER_LEARNING_PREFERENCE_LABELS_V1.memorizationSpacedPractice,
          value: 'enabled',
          dateExpression: null,
          sourceText: '暗記は今後も分けて復習する形でいい',
        },
      ],
    });
    finalizeStagedUserPlanningContextV1({
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      requestId: 'turn-1',
    });

    expect(loadDurableUserLearningPreferencesV1({
      ownerId: 'owner-1',
      currentDate: '2026-10-01',
    })).toEqual({
      memorizationSessionDurationMinutes: 20,
      memorizationSpacedPractice: true,
    });
  });

  it('ignores malformed canonical values instead of interpreting free text', () => {
    stageUserPlanningContextFactsV1({
      ownerId: 'owner-2',
      conversationId: 'conversation-2',
      requestId: 'turn-1',
      observedDate: '2026-08-17',
      facts: [{
        localId: 'duration',
        kind: 'learning_preference',
        label: USER_LEARNING_PREFERENCE_LABELS_V1.memorizationSessionDurationMinutes,
        value: '20分くらい',
        dateExpression: null,
        sourceText: '暗記は20分くらい',
      }],
    });
    finalizeStagedUserPlanningContextV1({
      ownerId: 'owner-2',
      conversationId: 'conversation-2',
      requestId: 'turn-1',
    });

    expect(loadDurableUserLearningPreferencesV1({
      ownerId: 'owner-2',
      currentDate: '2026-08-18',
    })).toEqual({
      memorizationSessionDurationMinutes: null,
      memorizationSpacedPractice: false,
    });
  });
});
