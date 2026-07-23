import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
  type MemoryStorageHarness,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import {
  loadOwnedWeeklyPlanningState,
  saveOwnedWeeklyPlanningState,
} from '../weeklyPlanningOwnedStorage';
import {
  canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5,
} from '../semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import {
  resetWeeklyPlanningRuntimeModeForTest,
  setWeeklyPlanningRuntimeMode,
} from './weeklyPlanningRuntimeMode';
import {
  getOrCreateWeeklyPlanningStableV5RuntimeSession,
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';
import {
  getWeeklyPlanningStableV5SessionStorageKeyForTest,
  loadWeeklyPlanningStableV5PersistedSession,
} from './weeklyPlanningStableV5SessionStorage';

const OWNER_ID = 'owner-1';
const WEEK_START = '2026-07-20';
const CONVERSATION_ID = 'conversation-1';

function graph() {
  const document: WeeklyPlanningSemanticDocumentV5 = {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      category: 'study',
      title: '英単語',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-1',
        quantityRole: 'target',
        amount: 30,
        unitCode: 'minute',
        unitLabel: '分',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '英単語を30分進める',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '英単語を30分進める',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: createEmptyWeeklyPlanningFactGraphV5(),
    document,
    context: {
      conversationId: CONVERSATION_ID,
      turnId: 'turn-1',
      expectedRevision: 0,
    },
  });
  if (result.status !== 'applied') throw new Error(result.errors.join(','));
  return result.graph;
}

function restoredState() {
  const initial = createInitialPlanningState(WEEK_START);
  const withUser = weeklyPlanningReducer(initial, {
    type: 'append_message',
    message: {
      id: 'turn-1:user',
      role: 'user',
      content: '英単語を30分進めたい',
      createdAt: '2026-07-23T08:00:00.000Z',
    },
  });
  return weeklyPlanningReducer(withUser, {
    type: 'append_message',
    message: {
      id: 'turn-1:assistant',
      role: 'assistant',
      content: '条件を整理できました。',
      createdAt: '2026-07-23T08:00:01.000Z',
    },
  });
}

describe('Stable V5 persisted runtime session', () => {
  let storageHarness: MemoryStorageHarness;
  let restoreWindow: () => void;

  beforeEach(() => {
    storageHarness = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    setWeeklyPlanningRuntimeMode('stable_v5');
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    resetWeeklyPlanningRuntimeModeForTest();
    restoreWindow();
  });

  it('restores conversation and Fact Graph together after runtime memory is lost', () => {
    const factGraph = graph();
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: CONVERSATION_ID,
      graph: factGraph,
    });
    const state = restoredState();

    saveOwnedWeeklyPlanningState(OWNER_ID, state);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();

    const loadedState = loadOwnedWeeklyPlanningState(OWNER_ID, WEEK_START);
    const persisted = loadWeeklyPlanningStableV5PersistedSession({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
    });

    expect(loadedState.messages).toEqual(state.messages);
    expect(persisted).not.toBeNull();
    expect(persisted?.conversationId).toBe(CONVERSATION_ID);
    expect(persisted?.graph.revision).toBe(factGraph.revision);

    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: persisted!.conversationId,
      graph: persisted!.graph,
    });
    expect(getOrCreateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
    }).graph).toEqual(factGraph);
  });

  it('does not persist the half-completed state of a pending turn', () => {
    const factGraph = graph();
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: CONVERSATION_ID,
      graph: factGraph,
    });
    const state = restoredState();
    saveOwnedWeeklyPlanningState(OWNER_ID, state);
    const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER_ID, WEEK_START);
    const before = storageHarness.values.get(key);

    saveOwnedWeeklyPlanningState(OWNER_ID, {
      ...state,
      pendingTurn: {
        conversationId: CONVERSATION_ID,
        turnId: 'turn-2',
        requestId: 'request-2',
        weekStartDate: WEEK_START,
        baseRevision: state.revision,
        startedAt: '2026-07-23T08:01:00.000Z',
      },
      messages: [
        ...state.messages,
        {
          id: 'turn-2:user',
          role: 'user',
          content: '追加条件',
          createdAt: '2026-07-23T08:01:00.000Z',
        },
      ],
    });

    expect(storageHarness.values.get(key)).toBe(before);
  });

  it('rejects a graph copied under a different conversation', () => {
    const factGraph = graph();
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: CONVERSATION_ID,
      graph: factGraph,
    });
    saveOwnedWeeklyPlanningState(OWNER_ID, restoredState());
    const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER_ID, WEEK_START);
    const envelope = JSON.parse(storageHarness.values.get(key)!) as Record<string, unknown>;
    envelope.conversationId = 'conversation-tampered';
    storageHarness.values.set(key, JSON.stringify(envelope));

    expect(loadWeeklyPlanningStableV5PersistedSession({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
    })).toBeNull();
    expect(storageHarness.values.has(key)).toBe(false);
  });
});
