import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
  type MemoryStorageHarness,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import {
  loadOwnedWeeklyPlanningState,
  saveOwnedWeeklyPlanningState,
} from '../weeklyPlanningOwnedStorage';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
} from '../preview/weeklyPlanningPreviewBlocks';
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
  getOrCreateWeeklyPlanningStableV5RuntimeSession,
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';
import {
  getWeeklyPlanningStableV5SessionStorageKeyForTest,
  loadWeeklyPlanningStableV5PersistedSession,
} from './weeklyPlanningStableV5SessionStorage';
import {
  useWeeklyPlanningApplication,
  type WeeklyPlanningApplication,
} from './useWeeklyPlanningApplication';

const OWNER_ID = 'owner-1';
const WEEK_START = '2026-07-20';
const SELECTED_DATE = '2026-07-23';
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

function previewCandidate(factGraph: ReturnType<typeof graph>) {
  const taskId = factGraph.tasks[0].id;
  const workloadId = factGraph.workloads[0].id;
  return {
    stableKey: `stable-v5:${factGraph.revision}:${workloadId}:0`,
    date: SELECTED_DATE,
    startTime: '18:00',
    endTime: '18:30',
    durationMinutes: 30,
    title: '英単語 30分',
    field: '英単語',
    year: 0,
    estimatedMinutes: 30,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: workloadId,
    stableV5Metadata: {
      runtime: 'stable_v5',
      conversationId: CONVERSATION_ID,
      graphRevision: factGraph.revision,
      taskId,
      sourceFactRefs: [taskId, workloadId],
      planType: 'study',
    },
  } as WeeklyDraftCandidate & {
    stableV5Metadata: {
      runtime: 'stable_v5';
      conversationId: string;
      graphRevision: number;
      taskId: string;
      sourceFactRefs: string[];
      planType: 'study';
    };
  };
}

function persistStateWithGraph(state = restoredState()) {
  const factGraph = graph();
  hydrateWeeklyPlanningStableV5RuntimeSession({
    ownerId: OWNER_ID,
    weekStartDate: WEEK_START,
    conversationId: CONVERSATION_ID,
    graph: factGraph,
  });
  saveOwnedWeeklyPlanningState(OWNER_ID, state);
  return { state, factGraph };
}

describe('Stable V5 persisted runtime session', () => {
  let storageHarness: MemoryStorageHarness;
  let restoreWindow: () => void;
  let renderer: ReactTestRenderer | null;

  beforeEach(() => {
    storageHarness = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    renderer = null;
  });

  afterEach(() => {
    renderer?.unmount();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    restoreWindow();
  });

  it('restores conversation and Fact Graph together after runtime memory is lost', () => {
    const { state, factGraph } = persistStateWithGraph();
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

  it('restores Stable V5 preview candidates with their graph freshness metadata', () => {
    const factGraph = graph();
    const candidate = previewCandidate(factGraph);
    const state = {
      ...restoredState(),
      mode: 'draft_created' as const,
      previewCandidates: [candidate],
    };
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: CONVERSATION_ID,
      graph: factGraph,
    });

    saveOwnedWeeklyPlanningState(OWNER_ID, state);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();

    const loaded = loadOwnedWeeklyPlanningState(OWNER_ID, WEEK_START);
    expect(loaded.previewCandidates).toEqual([candidate]);
    expect(
      (loaded.previewCandidates?.[0] as typeof candidate).stableV5Metadata,
    ).toMatchObject({
      runtime: 'stable_v5',
      conversationId: CONVERSATION_ID,
      graphRevision: factGraph.revision,
      taskId: factGraph.tasks[0].id,
    });
  });

  it('restores promoted draft blocks and keeps them bound to the same conversation', () => {
    const factGraph = graph();
    const candidate = previewCandidate(factGraph);
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER_ID,
      weekStartDate: WEEK_START,
      conversationId: CONVERSATION_ID,
      graph: factGraph,
    });
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: [candidate],
      userId: OWNER_ID,
      createdAt: '2026-07-23T08:05:00.000Z',
    });
    const state = {
      ...restoredState(),
      mode: 'awaiting_approval' as const,
      draftBlocks: blocks,
      previewCandidates: [],
    };

    saveOwnedWeeklyPlanningState(OWNER_ID, state);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();

    const loaded = loadOwnedWeeklyPlanningState(OWNER_ID, WEEK_START);
    expect(loaded.draftBlocks).toEqual(blocks);
    expect(loaded.draftBlocks[0].behaviorMetadata).toMatchObject({
      conversationId: CONVERSATION_ID,
      stateRevision: factGraph.revision,
      compatibility: {
        candidateSource: 'stable_v5',
      },
      previewMetadata: {
        conversationId: CONVERSATION_ID,
        authorizedUserId: OWNER_ID,
      },
    });
  });

  it('hydrates the same conversation and graph when the application is unmounted and mounted again', () => {
    const { state, factGraph } = persistStateWithGraph();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    const observed: { current: WeeklyPlanningApplication | null } = { current: null };

    function Probe() {
      observed.current = useWeeklyPlanningApplication({
        userId: OWNER_ID,
        selectedDate: SELECTED_DATE,
        plans: [],
        scheduleTemplates: [],
        async saveWeeklyApprovedPlan() {
          return {} as Plan;
        },
      });
      return null;
    }

    act(() => {
      renderer = create(createElement(Probe));
    });
    expect(observed.current?.state.messages).toEqual(state.messages);
    expect(getOrCreateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
    }).graph).toEqual(factGraph);

    act(() => renderer?.unmount());
    renderer = null;
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();

    act(() => {
      renderer = create(createElement(Probe));
    });
    expect(observed.current?.state.messages).toEqual(state.messages);
    expect(getOrCreateWeeklyPlanningStableV5RuntimeSession({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
    }).graph.revision).toBe(factGraph.revision);
  });

  it('does not persist the half-completed state of a pending turn', () => {
    const { state } = persistStateWithGraph();
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
    persistStateWithGraph();
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
