import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';
import {
  getWeeklyPlanningStableV5SessionStorageKeyForTest,
} from './weeklyPlanningStableV5SessionStorage';
import {
  createMemoryStorageHarness,
  createWeeklyPlanningTestDraftBlock,
  installWeeklyPlanningTestStorage,
  type MemoryStorageHarness,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanningMessage } from '../types';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import {
  loadOwnedWeeklyPlanningState,
  saveOwnedWeeklyPlanningState,
} from '../weeklyPlanningOwnedStorage';

const OWNER_ID = 'owner-checkpoint-compaction';
const WEEK_START = '2026-08-10';
const CONVERSATION_ID = 'conversation-checkpoint-compaction';

function message(params: {
  turn: number;
  role: WeeklyPlanningMessage['role'];
  content: string;
}): WeeklyPlanningMessage {
  return {
    id: `${CONVERSATION_ID}:turn:${params.turn}:${params.role}`,
    role: params.role,
    content: params.content,
    createdAt: `2026-08-11T${String(9 + Math.floor((params.turn - 1) / 60)).padStart(2, '0')}:${String((params.turn - 1) % 60).padStart(2, '0')}:00.000Z`,
  };
}

function longConversationMessages(turnCount: number): WeeklyPlanningMessage[] {
  const filler = '会話履歴'.repeat(1_500);
  return Array.from({ length: turnCount }, (_, index) => index + 1).flatMap((turn) => [
    message({ turn, role: 'user', content: `turn-${turn}-user:${filler}` }),
    message({ turn, role: 'assistant', content: `turn-${turn}-assistant:${filler}` }),
  ]);
}

describe('Stable V5 checkpoint compaction', () => {
  let storageHarness: MemoryStorageHarness;
  let restoreWindow: () => void;

  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    storageHarness = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    bindWeeklyPlanningStableV5RuntimeSessionScope({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: CONVERSATION_ID,
    });
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    restoreWindow();
  });

  it('stores the newest recurrent state instead of falling back to an older checkpoint when raw history exceeds storage limits', () => {
    const oldState = {
      ...createInitialPlanningState(WEEK_START),
      conversationRequestSequence: 1,
      mode: 'collecting_tasks' as const,
      messages: [
        message({ turn: 1, role: 'user', content: 'old-user' }),
        message({ turn: 1, role: 'assistant', content: 'old-assistant' }),
      ],
      lastAssistantMessage: 'old-assistant',
    };
    saveOwnedWeeklyPlanningState(OWNER_ID, oldState);

    const messages = longConversationMessages(120);
    const newestState = {
      ...createInitialPlanningState(WEEK_START),
      revision: 240,
      conversationRequestSequence: 120,
      mode: 'collecting_tasks' as const,
      messages,
      lastAssistantMessage: messages[messages.length - 1].content,
      intakeState: {
        status: 'revision_pending' as const,
        intent: 'weekly_study_planning' as const,
        tasks: [],
        progress: [],
        unitRates: [],
        constraints: [],
        priorityPolicy: { kind: 'unknown' as const },
        missing: [],
        assumptions: [],
        uncertainties: [],
        questions: ['次の条件を教えてください。'],
        shouldCreateDraft: false,
        shouldSavePlan: false,
        draftGenerationIntent: 'user_authorized' as const,
        sourceTurns: ['最初に予定作成を依頼した'],
      },
    };

    saveOwnedWeeklyPlanningState(OWNER_ID, newestState);

    const stableKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER_ID, WEEK_START);
    const raw = storageHarness.values.get(stableKey);
    expect(raw).toBeDefined();
    expect(new TextEncoder().encode(raw!).byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);

    const persisted = JSON.parse(raw!) as {
      planningState: {
        conversationRequestSequence: number;
        messages: WeeklyPlanningMessage[];
        intakeState?: { draftGenerationIntent?: string };
      };
    };
    expect(persisted.planningState.conversationRequestSequence).toBe(120);
    expect(persisted.planningState.messages.length).toBeLessThanOrEqual(200);
    expect(persisted.planningState.messages.length).toBeGreaterThan(0);
    expect(persisted.planningState.messages.at(-1)?.id).toBe(
      `${CONVERSATION_ID}:turn:120:assistant`,
    );
    expect(persisted.planningState.intakeState?.draftGenerationIntent).toBe('user_authorized');

    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    const restored = loadOwnedWeeklyPlanningState(OWNER_ID, WEEK_START);
    expect(restored.conversationRequestSequence).toBe(120);
    expect(restored.messages.at(-1)?.id).toBe(`${CONVERSATION_ID}:turn:120:assistant`);
    expect(restored.intakeState?.draftGenerationIntent).toBe('user_authorized');
  });

  it('removes a stale Stable V5 checkpoint before using compatibility fallback', () => {
    const oldState = {
      ...createInitialPlanningState(WEEK_START),
      conversationRequestSequence: 1,
      mode: 'collecting_tasks' as const,
      messages: [message({ turn: 1, role: 'user', content: 'old-state' })],
    };
    saveOwnedWeeklyPlanningState(OWNER_ID, oldState);

    const invalidForStableCheckpoint = {
      ...createInitialPlanningState(WEEK_START),
      revision: 2,
      conversationRequestSequence: 2,
      mode: 'awaiting_approval' as const,
      draftBlocks: Array.from({ length: 501 }, (_, index) =>
        createWeeklyPlanningTestDraftBlock({
          id: `draft-${index + 1}`,
          userId: OWNER_ID,
        })),
    };
    saveOwnedWeeklyPlanningState(OWNER_ID, invalidForStableCheckpoint);

    const stableKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER_ID, WEEK_START);
    const compatibilityKey = `studyplanner.weeklyPlanning.${OWNER_ID}.${WEEK_START}`;
    expect(storageHarness.values.has(stableKey)).toBe(false);
    expect(storageHarness.values.has(compatibilityKey)).toBe(true);
  });
});
