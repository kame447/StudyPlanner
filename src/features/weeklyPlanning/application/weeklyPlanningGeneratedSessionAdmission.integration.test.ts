import type { PlanningState } from '../types';
import { exportUserPlanningContextSnapshotV1, resetUserPlanningContextRuntimeForTestV1, stageUserPlanningContextFactsV1 } from '../../userPlanningContext/userPlanningContextSpace';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from '../semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 } from '../semantic/weeklyPlanningSemanticTypesV5';
import { validateWeeklyPlanningFactGraphValueV5 } from '../semantic/weeklyPlanningFactGraphValidatorV5';
import { compileGenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../semantic/weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import { createMemoryStorageHarness, createWeeklyPlanningTestDraftBlock, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { createWeeklyPlanningControllerSession, submitWeeklyPlanningControlledTurn } from '../weeklyPlanningTurnController';
import { loadOwnedWeeklyPlanningState, saveOwnedWeeklyPlanningState } from '../weeklyPlanningOwnedStorage';
import { bindWeeklyPlanningStableV5RuntimeSessionScope, hydrateWeeklyPlanningStableV5RuntimeSession, commitWeeklyPlanningStableV5RuntimeGraph, getWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { weeklyPlanningTurnStagingLifecycle } from './weeklyPlanningTurnSideEffects';
import { getWeeklyPlanningStableV5SessionStorageKeyForTest, loadWeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionStorage';
import { prepareWeeklyPlanningStableV5Checkpoint } from './weeklyPlanningStableV5SessionCodec';

const OWNER = 'session-admission-owner';
const CONVERSATION = 'session-admission-conversation';
const WEEK = '2026-08-24';
const NOW = `${WEEK}T08:00:00.000Z`;
let storage: ReturnType<typeof createMemoryStorageHarness>;
let restore: () => void;
beforeEach(() => {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetUserPlanningContextRuntimeForTestV1();
  storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage);
  bindWeeklyPlanningStableV5RuntimeSessionScope({ ownerId: OWNER, conversationId: CONVERSATION, weekStartDate: WEEK });
});
afterEach(() => { resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetUserPlanningContextRuntimeForTestV1(); restore(); });

/** Reachability probe: actual accepted workload + session duration flow through
 * the extracted original splitter, default placement, and current checkpoint owners. */
function generatedPreview(amount: number, requestId: string, expectedCount: number | null, previousGraph: WeeklyPlanningFactGraphV5 = createEmptyWeeklyPlanningFactGraphV5()) {
  const canonical = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: previousGraph,
    context: { conversationId: CONVERSATION, turnId: requestId, expectedRevision: previousGraph.revision },
    document: { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss', planningWindow: null,
      tasks: [{ localId: 'task', title: '作業', category: 'non_study', study: null, sourceText: '受理済みの作業',
        workloads: [{ localId: 'work', quantityRole: 'target', amount,
          unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '受理済みの作業' }],
        effortEstimates: [{ localId: 'cap', targetLocalId: 'task', kind: 'session_duration', minutes: 1, unitCode: 'session', precision: 'exact', sourceText: '1回1分' }], temporalConstraints: [], recurrence: [] }],
      relations: [], availabilityDeclarations: [{ localId: 'available', kind: 'available', dateExpression: null, namedTimePeriod: null,
        startTime: '06:00', endTime: '23:00', recurrenceKind: 'daily', days: [], constraintLevel: 'hard', sourceText: '毎日6時から23時に空き時間がある' }], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
    },
  });
  expect(canonical.status).toBe('applied');
  const graph = canonical.graph;
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
  const compiled = compileGenericSchedulerInput({ graph, context: {
    ownerId: OWNER, currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-08-30', timeZone: 'UTC',
  } });
  if (expectedCount === null) {
    expect(compiled.status).toBe('needs_resolution');
    expect(compiled.input).toBeNull();
    expect(compiled.issues).toContainEqual(expect.objectContaining({ blocking: true, details: expect.objectContaining({ reason: 'session_count_limit' }) }));
    return { graph, candidates: [] };
  }
  expect(compiled.status).toBe('ready');
  const input = compiled.input!;
  expect(input.movableWorkItems).toHaveLength(expectedCount);
  expect(input.movableWorkItems.every(item => item.estimatedMinutes === 1)).toBe(true);
  expect(input.movableWorkItems.every(item => graph.effortEstimates.some(fact => fact.kind === 'session_duration'
    && fact.taskId === item.taskId && item.sourceFactRefs.includes(fact.id)))).toBe(true);
  const preview = scheduleWeeklyPlanningStableV5Preview({ input, graph: createWeeklyPlanningPlacementGraphViewV5(graph) });
  expect(preview.status).toBe('ready'); expect(preview.candidates).toHaveLength(expectedCount);
  return { graph, candidates: preview.candidates };
}

describe('generated session count at the Stable V5 publication/checkpoint boundary', () => {
  it('preserves the existing512 computational guard after512 accepted minutes round to525 allocated minutes', () => {
    generatedPreview(512, 'numeric-limit', null);
  });
  it.each([{ amount: 495, count: 495 }, { amount: 500, count: 510 }])('checks $amount accepted minutes producing $count sessions before publication', async ({ amount, count }) => {
    let state = createInitialPlanningState(WEEK);
    state = { ...state, mode: 'collecting_tasks', messages: [{ id: `${CONVERSATION}:turn:0:assistant`, role: 'assistant', content: 'previous', createdAt: NOW }] };
    saveOwnedWeeklyPlanningState(OWNER, state);
    const stableKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK);
    expect(storage.values.has(stableKey)).toBe(true);
    let caught: unknown;
    const outcome = await submitWeeklyPlanningControlledTurn({
      session: createWeeklyPlanningControllerSession(OWNER, WEEK, CONVERSATION), ownerId: OWNER, userText: '受理した作業を配置して',
      getState: () => state, dispatch(action) { state = weeklyPlanningReducer(state, action); return state; }, now: () => NOW,
      async execute({ pending }) {
        const generated = generatedPreview(amount, pending.requestId, count);
        commitWeeklyPlanningStableV5RuntimeGraph({ ownerId: OWNER, conversationId: CONVERSATION, graph: generated.graph });
        return { state: { ...createInitialPlanningIntakeState(), status: 'draft_ready', shouldCreateDraft: true, draftGenerationIntent: 'user_authorized' },
          message: '候補を確認してください。', draftCandidates: generated.candidates, stableV5Graph: generated.graph };
      },
      prepareExecutionCommit: ({ pending }) => weeklyPlanningTurnStagingLifecycle.prepare({ ownerId: OWNER, pending }),
      discardExecutionResult: ({ pending }) => weeklyPlanningTurnStagingLifecycle.discard(pending),
      onCommittedTurn: ({ committed }) => saveOwnedWeeklyPlanningState(OWNER, committed),
      onFailedTurn: ({ pending, failedState }) => { weeklyPlanningTurnStagingLifecycle.discard(pending); saveOwnedWeeklyPlanningState(OWNER, failedState); },
    }).catch(error => { caught = error; return undefined; });
    const persisted = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    const observation = {
      amount, count, accepted: outcome?.accepted ?? null, returnedCandidates: outcome?.draftCandidates.length ?? 0,
      publishedCandidates: state.previewCandidates!.length,
      runtimeRevision: getWeeklyPlanningStableV5RuntimeSession(CONVERSATION)?.graph.revision,
      checkpointStatus: prepareWeeklyPlanningStableV5Checkpoint({ ownerId: OWNER, conversationId: CONVERSATION, weekStartDate: WEEK, graph: getWeeklyPlanningStableV5RuntimeSession(CONVERSATION)!.graph, planningState: state }).status,
      stableStored: persisted !== null, stableCandidates: persisted?.planningState.previewCandidates!.length ?? null,
      compatibilityStored: storage.values.has(`studyplanner.weeklyPlanning.${OWNER}.${WEEK}`),
    };
    console.info('session-source-reachability', JSON.stringify(observation));
    if (count === 495) {
      expect(caught).toBeUndefined();
      expect(observation).toMatchObject({ accepted: true, returnedCandidates: 495, publishedCandidates: 495, runtimeRevision: 1,
        checkpointStatus: 'ready', stableStored: true, stableCandidates: 495, compatibilityStored: false });
      resetWeeklyPlanningStableV5RuntimeSessionsForTest();
      expect(loadOwnedWeeklyPlanningState(OWNER, WEEK).previewCandidates).toEqual(state.previewCandidates);
    } else {
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('Stable V5 turn state violates its checkpoint shape contract.');
      expect(observation).toMatchObject({ accepted: null, returnedCandidates: 0, publishedCandidates: 0, runtimeRevision: 0, stableStored: true, compatibilityStored: false });
    }
  });

  it('rolls an unrepresentable multi-workload result back without replacing the prior graph, preview, draft or context', async () => {
    const previous = generatedPreview(5, 'previous-request', 5);
    hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, conversationId: CONVERSATION, weekStartDate: WEEK, graph: previous.graph });
    const oldDrafts = [createWeeklyPlanningTestDraftBlock({ id: 'previous-draft', userId: OWNER, overrides: { date: WEEK } })];
    let state: PlanningState = { ...createInitialPlanningState(WEEK), revision: 2, conversationRequestSequence: 1,
      mode: 'draft_created' as const, previewCandidates: previous.candidates, draftBlocks: oldDrafts,
      messages: [{ id: `${CONVERSATION}:turn:1:assistant`, role: 'assistant' as const, content: 'previous preview', createdAt: NOW }] };
    saveOwnedWeeklyPlanningState(OWNER, state);
    expect(loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })?.graph).toEqual(previous.graph);
    const contextBefore = exportUserPlanningContextSnapshotV1({ ownerId: OWNER, currentDate: WEEK });
    let completed = false;
    let committed = false;
    const submission = submitWeeklyPlanningControlledTurn({
      session: createWeeklyPlanningControllerSession(OWNER, WEEK, CONVERSATION), ownerId: OWNER, userText: '作業を追加して', now: () => NOW,
      getState: () => state, dispatch(action) { state = weeklyPlanningReducer(state, action); return state; },
      async execute({ pending }) {
        const generated = generatedPreview(500, pending.requestId, 515, previous.graph);
        expect(generated.graph.revision).toBe(2);
        expect(generated.graph.tasks).toHaveLength(2);
        commitWeeklyPlanningStableV5RuntimeGraph({ ownerId: OWNER, conversationId: CONVERSATION, graph: generated.graph });
        stageUserPlanningContextFactsV1({ ownerId: OWNER, conversationId: CONVERSATION, requestId: pending.requestId,
          observedDate: WEEK, now: NOW, facts: [{ localId: 'new-concern', kind: 'concern', label: '作業', value: '追加', dateExpression: null, sourceText: '作業を追加して' }] });
        return { state: { ...createInitialPlanningIntakeState(), status: 'draft_ready', shouldCreateDraft: true, draftGenerationIntent: 'user_authorized' },
          message: 'new preview must not publish', draftCandidates: generated.candidates, stableV5Graph: generated.graph };
      },
      prepareExecutionCommit({ pending }) {
        const prepared = weeklyPlanningTurnStagingLifecycle.prepare({ ownerId: OWNER, pending })!;
        return { rollback: () => prepared.rollback(), complete: () => { completed = true; prepared.complete(); } };
      },
      discardExecutionResult: ({ pending }) => weeklyPlanningTurnStagingLifecycle.discard(pending),
      onCommittedTurn: ({ committed: next }) => { committed = true; saveOwnedWeeklyPlanningState(OWNER, next); },
      onFailedTurn: ({ pending, failedState }) => { weeklyPlanningTurnStagingLifecycle.discard(pending); saveOwnedWeeklyPlanningState(OWNER, failedState); },
    });
    await expect(submission).rejects.toThrow('Stable V5 turn state violates its checkpoint shape contract.');
    expect(completed).toBe(false); expect(committed).toBe(false);
    expect(getWeeklyPlanningStableV5RuntimeSession(CONVERSATION)?.graph).toEqual(previous.graph);
    expect(state.previewCandidates).toEqual(previous.candidates); expect(state.draftBlocks).toEqual(oldDrafts);
    expect(state.messages.some(message => message.content === 'new preview must not publish')).toBe(false);
    expect(exportUserPlanningContextSnapshotV1({ ownerId: OWNER, currentDate: WEEK })).toEqual(contextBefore);
    const persisted = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })!;
    expect(persisted.graph).toEqual(previous.graph); expect(persisted.planningState.previewCandidates).toEqual(previous.candidates);
    expect(persisted.planningState.draftBlocks).toEqual(oldDrafts);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    const restored = loadOwnedWeeklyPlanningState(OWNER, WEEK);
    expect(restored.previewCandidates).toEqual(previous.candidates); expect(restored.draftBlocks).toEqual(oldDrafts);
  });
});
