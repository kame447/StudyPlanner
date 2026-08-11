import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
  type MemoryStorageHarness,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import {
  loadOwnedWeeklyPlanningState,
  saveOwnedWeeklyPlanningState,
} from '../weeklyPlanningOwnedStorage';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

const OWNER_ID = 'owner-authorization-memory';
const WEEK_START = '2026-08-10';
const CONVERSATION_ID = 'conversation-authorization-memory';

function authorizedIntakeState(): PlanningIntakeState {
  return {
    status: 'revision_pending',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: ['予定に入れる作業を教えてください。'],
    lastQuestionContext: {
      kind: 'missing',
      targetSlot: 'stable_v5:missing_schedulable_work',
      intent: 'missing_schedulable_work',
    },
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'user_authorized',
    sourceTurns: ['来週の予定を立てたい'],
  };
}

describe('Stable V5 authorization persistence', () => {
  let storageHarness: MemoryStorageHarness;
  let restoreWindow: () => void;

  beforeEach(() => {
    storageHarness = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    restoreWindow();
  });

  it('restores user_authorized after runtime memory is lost', () => {
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: CONVERSATION_ID,
      graph: createEmptyWeeklyPlanningFactGraphV5(),
    });
    const state = {
      ...createInitialPlanningState(WEEK_START),
      intakeState: authorizedIntakeState(),
      messages: [{
        id: `${CONVERSATION_ID}:turn:1:user`,
        role: 'user' as const,
        content: '来週の予定を立てたい',
        createdAt: '2026-08-11T09:00:00.000Z',
      }],
    };

    saveOwnedWeeklyPlanningState(OWNER_ID, state);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();

    const restored = loadOwnedWeeklyPlanningState(OWNER_ID, WEEK_START);
    expect(restored.intakeState).toMatchObject({
      status: 'revision_pending',
      draftGenerationIntent: 'user_authorized',
      lastQuestionContext: {
        targetSlot: 'stable_v5:missing_schedulable_work',
      },
    });
    expect(restored.messages).toEqual(state.messages);
    expect(storageHarness.values.size).toBeGreaterThan(0);
  });
});
