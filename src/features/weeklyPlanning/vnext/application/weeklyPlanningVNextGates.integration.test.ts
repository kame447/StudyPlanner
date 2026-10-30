// No-cost integration gates for #926 (no provider, no remote, no production wiring):
// A. saved V5 checkpoint → VNext format → reload, presentation freshness, rollback reading
// B. question → bound answer → projection → existing V5 scheduler/preview → stale before approval
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseWeeklyPlanningStableV5PersistedSession,
  prepareWeeklyPlanningStableV5Checkpoint,
  serializeWeeklyPlanningStableV5CheckpointWithMessageCount,
} from '../../application/weeklyPlanningStableV5SessionCodec';
import {
  getWeeklyPlanningStableV5SessionStorageKeyForTest,
  readWeeklyPlanningStableV5PersistedSession,
} from '../../application/weeklyPlanningStableV5SessionStorage';
import type { PlanningIntakeState } from '../../intake/weeklyPlanningIntakeTypes';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from '../../intake/weeklyPlanningQuestionPresentation';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
  type WorkloadFactV5,
} from '../../semantic/weeklyPlanningFactGraphV5';
import { scheduleWeeklyPlanningStableV5Preview } from '../../semantic/weeklyPlanningStableV5PlacementEngine';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
  type MemoryStorageHarness,
} from '../../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanningMessage } from '../../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../../weeklyPlanningReducer';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { compileWeeklyPlanningVNextSchedulerInput } from '../projection/weeklyPlanningVNextSchedulerGraph';
import { applyWeeklyPlanningVNextTurn } from '../semantic/weeklyPlanningVNextTransaction';
import { createVNextLineageResolver } from '../weeklyPlanningVNextWorkIdentity';
import type { VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { bindWeeklyPlanningVNextAnswer } from './weeklyPlanningVNextAnswerBinding';
import {
  migrateWeeklyPlanningV5GraphToVNextSession,
  parseWeeklyPlanningVNextSessionCheckpoint,
  serializeWeeklyPlanningVNextSessionCheckpoint,
} from './weeklyPlanningVNextSessionCheckpoint';

const OWNER = 'owner-1';
const WEEK = '2026-11-02';
const CONVERSATION = 'conversation-gates';
const source = (semanticLocalId: string) => ({
  conversationId: CONVERSATION, turnId: 'turn-1', semanticLocalId, sourceText: 'スライドは20枚で12枚できた', origin: 'user' as const,
});

function workload(id: string, role: WorkloadFactV5['quantityRole'], amount: number, semanticLocalId = id): WorkloadFactV5 {
  return {
    id, taskId: 'task-1', componentId: null, quantityRole: role, amount, unitCode: 'page', unitLabel: 'ページ',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, source: source(semanticLocalId), createdRevision: 1,
  };
}

/** Saved by Stable V5: total 20, completed 12 and the V5-stored derived remaining 8. */
function v5Graph(): WeeklyPlanningFactGraphV5 {
  const workloads = [
    workload('total', 'scope_total', 20),
    workload('completed', 'completed', 12),
    workload('derived', 'remaining', 8, 'completed:derived-bounded-remaining:derived'),
  ];
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 4,
    tasks: [{ id: 'task-1', category: 'study', title: 'スライド', source: source('task-1'), createdRevision: 1 }],
    workloads,
    factLifecycles: [{ id: 'task-1' }, ...workloads].map((fact) => ({
      factId: fact.id, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null,
    })),
  };
}

function message(id: string, role: 'user' | 'assistant', content: string): WeeklyPlanningMessage {
  return { id, role, content, createdAt: '2026-11-02T08:00:00.000Z' } as WeeklyPlanningMessage;
}

function v5Raw(graph: WeeklyPlanningFactGraphV5): string {
  let planningState = createInitialPlanningState(WEEK);
  planningState = weeklyPlanningReducer(planningState, { type: 'append_message', message: message('u1', 'user', 'スライドは20枚で12枚できた') });
  planningState = weeklyPlanningReducer(planningState, { type: 'append_message', message: message('a1', 'assistant', '残り8枚ですね。') });
  const prepared = prepareWeeklyPlanningStableV5Checkpoint({
    ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION, graph, planningState,
  });
  if (prepared.status !== 'ready') throw new Error(`V5 checkpoint ${prepared.status}`);
  return serializeWeeklyPlanningStableV5CheckpointWithMessageCount({
    ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION, graph,
    planningState: prepared.planningState, savedAt: '2026-11-02T08:00:02.000Z', messageCount: 2,
  })!;
}

function presentedIntake(graphRevision: number): PlanningIntakeState {
  return {
    lastQuestionContext: {
      kind: 'missing', targetSlot: 'stable_v5:missing_effort_estimate', intent: 'total_duration',
      presentation: {
        version: 1, turnId: 'turn-present', assistantMessageId: 'a2', planningStateRevision: 9, graphRevision,
        content: { responseSource: 'ai', currentTurnGrounding: 'none', selfRepairNotice: false,
          groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false },
      },
    },
  } as unknown as PlanningIntakeState;
}

function applyTurn(state: WeeklyPlanningVNextState, delta: VNextTurnDelta, turnKey: string, sourceText: string): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(state, delta, {
    turnKey, acceptedDate: '2026-11-02', expectedRevision: state.graph.revision, conversationId: CONVERSATION, turnId: turnKey, sourceText,
  });
  if (result.status !== 'applied') throw new Error(`${result.status}: ${'errors' in result ? JSON.stringify(result.errors) : ''}`);
  return result.state;
}

describe('#926 no-cost integration gates', () => {
  let harness: MemoryStorageHarness;
  let restore: () => void;
  beforeEach(() => {
    harness = createMemoryStorageHarness();
    restore = installWeeklyPlanningTestStorage(harness.storage);
  });
  afterEach(() => restore());

  it('A: a saved V5 checkpoint migrates to the VNext format, reloads with a fresh question, and rolls back without misreading', () => {
    const graph = v5Graph();
    const raw = v5Raw(graph);
    const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK);
    harness.values.set(key, raw);

    // Old checkpoint → read by the current V5 reader exactly as production does.
    const v5Read = readWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
    expect(v5Read.status).toBe('ready');
    const v5Session = v5Read.status === 'ready' ? v5Read.session! : null;
    expect(v5Session?.graph.revision).toBe(4);

    // → VNext format: read-only migration, revision bump, then save and reload.
    const { state } = migrateWeeklyPlanningV5GraphToVNextSession(v5Session!.graph);
    expect(state.graph.revision).toBe(5);
    const projection = projectWeeklyPlanningVNext(state);
    const presentedQuestion = { questionKey: projection.questions[0].key, graphRevision: projection.graphRevision };
    const vnextRaw = serializeWeeklyPlanningVNextSessionCheckpoint({
      ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION,
      vnext: { state, presentedQuestion, preview: null, messages: [] }, savedAt: '2026-11-02T08:05:00.000Z',
    })!;
    const reloaded = parseWeeklyPlanningVNextSessionCheckpoint({ raw: vnextRaw, ownerId: OWNER, weekStartDate: WEEK })!;
    expect(reloaded.vnext.state).toEqual(state);

    // Reload + freshness: the presented question still binds, against the reloaded state.
    const reloadedProjection = projectWeeklyPlanningVNext(reloaded.vnext.state);
    const messages = [...v5Session!.planningState.messages, message('a2', 'assistant', '残り8枚は何分かかりそうですか？')];
    const fresh = resolveWeeklyPlanningQuestionPresentationFreshness({
      previousState: presentedIntake(reloaded.vnext.state.graph.revision), inputStateRevision: 9, messages,
      graphRevision: reloaded.vnext.state.graph.revision,
    });
    expect(bindWeeklyPlanningVNextAnswer({
      presentationFresh: fresh.status === 'fresh', presented: reloaded.vnext.presentedQuestion, projection: reloadedProjection,
      lineageOf: createVNextLineageResolver(reloaded.vnext.state.graph).lineageOf,
      answer: { kind: 'estimate_minutes', minutes: 60, per: 'whole_work' },
    }).status).toBe('bound');
    // A presentation made against the V5 revision is stale after migration.
    const staleFromV5 = resolveWeeklyPlanningQuestionPresentationFreshness({
      previousState: presentedIntake(v5Session!.graph.revision), inputStateRevision: 9, messages,
      graphRevision: reloaded.vnext.state.graph.revision,
    });
    expect(staleFromV5).toEqual({ status: 'stale', reason: 'graph_revision_mismatch' });

    // Rollback: the current V5 reader never misreads a VNext checkpoint; it keeps the bytes in retention.
    harness.values.set(key, vnextRaw);
    expect(readWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK }))
      .toEqual({ status: 'ready', session: null });
    expect(harness.values.has(key)).toBe(false);
    const retained = [...harness.values.entries()].filter(([, value]) => value.includes(JSON.stringify(vnextRaw).slice(1, -1)));
    expect(retained).toHaveLength(1);
    expect(JSON.parse(retained[0][1])).toMatchObject({ sourceKind: 'stable_v5', raw: vnextRaw });
    // The migration never touched the V5 checkpoint: it still parses to the same graph.
    expect(parseWeeklyPlanningStableV5PersistedSession({ raw, ownerId: OWNER, weekStartDate: WEEK })?.graph).toEqual(graph);
  });

  it('B: a question answer reaches the existing V5 preview, and a later correction makes that preview stale before approval', () => {
    let state = migrateWeeklyPlanningV5GraphToVNextSession(v5Graph()).state;
    const writesBefore = new Map(harness.values);
    const asked = projectWeeklyPlanningVNext(state);
    const context = { ownerId: OWNER, currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' };
    expect(compileWeeklyPlanningVNextSchedulerInput({ state, projection: asked, context })).toEqual({ status: 'not_ready' });

    const binding = bindWeeklyPlanningVNextAnswer({
      presentationFresh: resolveWeeklyPlanningQuestionPresentationFreshness({
        previousState: presentedIntake(state.graph.revision), inputStateRevision: 9,
        messages: [message('a2', 'assistant', '残り8枚は何分かかりそうですか？')], graphRevision: state.graph.revision,
      }).status === 'fresh',
      presented: { questionKey: asked.questions[0].key, graphRevision: asked.graphRevision },
      projection: asked,
      lineageOf: createVNextLineageResolver(state.graph).lineageOf,
      answer: { kind: 'estimate_minutes', minutes: 60, per: 'whole_work' },
    });
    if (binding.status !== 'bound') throw new Error(binding.status);
    state = applyTurn(state, binding.delta, 'answer', '60分');

    const ready = projectWeeklyPlanningVNext(state);
    expect(ready.readiness).toBe('ready');
    const scheduled = compileWeeklyPlanningVNextSchedulerInput({ state, projection: ready, context });
    if (scheduled.status !== 'compiled') throw new Error('not ready');
    const compiled = scheduled.compilation;
    expect(compiled.status).toBe('ready');
    expect(compiled.input!.graphRevision).toBe(state.graph.revision);
    const answerId = state.graph.effortEstimates[0].id;
    expect(compiled.input!.movableWorkItems).toEqual([expect.objectContaining({
      baseEstimatedMinutes: 60, quantity: expect.objectContaining({ amount: 8 }),
      // provenance names only stated facts: the task, the total whose work it is, and the answer
      estimateSourceFactIds: [answerId],
      sourceFactRefs: expect.arrayContaining(['task-1', 'total', answerId]),
    })]);
    expect(compiled.input!.movableWorkItems.flatMap((work) => [...work.sourceFactRefs, ...work.estimateSourceFactIds])
      .filter((id) => id.startsWith('vnext-'))).toEqual([]);
    const preview = scheduleWeeklyPlanningStableV5Preview({
      input: compiled.input!,
      graph: scheduled.placementGraph,
      notBefore: { date: '2026-11-02', time: '09:00' },
    });
    expect(preview.status).toBe('ready');
    expect(preview.candidates.reduce((sum, candidate) => sum + candidate.durationMinutes, 0))
      .toBe(compiled.input!.movableWorkItems[0].estimatedMinutes);

    // Before approval: a quantity correction moves the revision; the preview's revision no longer matches,
    // and the old total no longer applies to 6 pages, so the projection asks again.
    state = applyTurn(state, { add: [], remove: [], relate: [], defer: [], patch: [{
      kind: 'workload', localId: 'r6', targetFactId: 'completed', amountDelta: null,
      changes: { amount: 14, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null },
    }] }, 'correction', '14枚できた');
    expect(state.graph.revision).not.toBe(compiled.input!.graphRevision);
    expect(projectWeeklyPlanningVNext(state).questions[0]).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 6 } });
    expect(compileWeeklyPlanningVNextSchedulerInput({ state, projection: projectWeeklyPlanningVNext(state), context }).status).toBe('not_ready');
    expect(harness.values).toEqual(writesBefore); // nothing was saved or approved
  });
});
