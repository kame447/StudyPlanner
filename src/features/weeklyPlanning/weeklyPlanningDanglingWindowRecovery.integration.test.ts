import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, expect, it } from 'vitest';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { eventDocument, eventRendererReply, eventStudyTask } from './testUtils/weeklyPlanningFixedEventOnlyFixture';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from './testUtils/weeklyPlanningApplicationTestHarness';
import { saveWeeklyPlanningStableV5PersistedSession, loadWeeklyPlanningStableV5PersistedSession } from './application/weeklyPlanningStableV5SessionStorage';
import { hydrateWeeklyPlanningStableV5RuntimeSession } from './application/weeklyPlanningStableV5RuntimeSession';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { weeklyPlanningActiveFactReferenceErrorsV5 } from './semantic/weeklyPlanningActiveFactReferenceInvariantV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './semantic/weeklyPlanningSemanticDocumentV5';
import { workloadLifecycleFixture } from './testUtils/weeklyPlanningWorkloadLifecycleFixture';
import { createInitialPlanningState } from './weeklyPlanningReducer';
import { weeklyPlanningIntroducedActiveFactReferenceErrorsV5 } from './semantic/weeklyPlanningActiveFactReferenceInvariantV5';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let restoreStorage: (() => void) | undefined;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); restoreStorage?.(); });

it.each(['legacy_v5', 'interaction_v1'] as const)('repairs old dangling questions in the same committed state after a real storage reload (%s)', async architecture => {
  const storage = createMemoryStorageHarness();
  restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
  provider = installScriptedWeeklyPlanningProvider(call => call.kind === 'renderer' ? eventRendererReply(call)
    : JSON.stringify(eventDocument({ planningIntent: 'create_plan', planningWindow: { localId: 'old', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: '明日' },
      uncertainties: [{ localId: 'need', targetLocalId: 'old', field: 'opaque', reason: '明日の期間を確認', sourceText: '明日' }], ...(architecture === 'interaction_v1' ? { conversationActs: [] } : {}) })));
  const conversation = createScriptedConversation({ provider, architecture, now: () => '2026-10-07T00:00:00.000Z' });
  await conversation.submit('明日の予定を立てたい');
  const oldGraph = conversation.graph()!;
  const need = oldGraph.uncertainties[0];
  const next = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: oldGraph,
    document: eventDocument({ planningWindow: { localId: 'today', kind: 'relative_day', value: 'today', start: null, end: null, sourceText: '今日' } }) as unknown as WeeklyPlanningSemanticDocumentV5,
    context: { conversationId: conversation.conversationId, turnId: 'old-writer-turn', expectedRevision: oldGraph.revision } });
  expect(next.status).toBe('applied');
  // Precisely the old writer's bug: new active window, active need on old window.
  const graph = next.graph;
  graph.uncertainties[0] = need;
  graph.factLifecycles = graph.factLifecycles.map(entry => entry.factId === need.id
    ? { ...entry, status: 'active', terminalRevision: null, supersededByFactId: null } : entry);
  const scope = { ownerId: conversation.ownerId, weekStartDate: conversation.weekStartDate, conversationId: conversation.conversationId };
  const before = conversation.getState();
  const planningState = { ...before, intakeState: { ...before.intakeState!,
    questions: ['明日の期間を確認してください'],
    lastQuestionContext: { kind: 'missing' as const, targetSlot: 'stable_v5:semantic_uncertainty', intent: 'semantic_uncertainty', topicId: need.id },
  } };
  expect(weeklyPlanningActiveFactReferenceErrorsV5(graph)).toHaveLength(1);
  expect(saveWeeklyPlanningStableV5PersistedSession({ ...scope, graph, planningState })).toBe(true);
  const raw = [...storage.values.values()];
  provider.restore(); resetScriptedConversationRuntime();
  const loaded = loadWeeklyPlanningStableV5PersistedSession(scope);
  expect(loaded?.graph).toEqual(graph);
  expect([...storage.values.values()]).toEqual(raw);
  provider = installScriptedWeeklyPlanningProvider(call => call.kind === 'renderer' ? eventRendererReply(call)
    : JSON.stringify(eventDocument({ planningIntent: 'create_plan', tasks: [eventStudyTask()], ...(architecture === 'interaction_v1' ? { conversationActs: [] } : {}) })));
  hydrateWeeklyPlanningStableV5RuntimeSession({ ...scope, graph: loaded!.graph });
  const resumed = createScriptedConversation({ ...scope, provider, initialState: loaded!.planningState, now: () => '2026-10-07T00:00:00.000Z' });
  const turn = await resumed.submit('数学を20分勉強する');
  expect(turn.result?.failure).toBeUndefined();
  expect(turn.result?.draftCandidates.length).toBeGreaterThan(0);
  expect(turn.result?.message).not.toContain('明日');
  expect(resumed.getState().intakeState?.lastQuestionContext).toBeUndefined();
  const repaired = resumed.graph()!;
  expect(repaired.factLifecycles.find(entry => entry.factId === need.id)?.status).toBe('removed');
  expect(weeklyPlanningActiveFactReferenceErrorsV5(repaired)).toEqual([]);
  expect(saveWeeklyPlanningStableV5PersistedSession({ ...scope, graph: repaired, planningState: resumed.getState() })).toBe(true);
  const checkpoint = loadWeeklyPlanningStableV5PersistedSession(scope)!;
  expect(checkpoint.graph).toEqual(repaired);
  expect(checkpoint.planningState.intakeState?.lastQuestionContext).toBeUndefined();
});

it.each(['legacy_v5', 'interaction_v1'] as const)('loads a pre-existing dangling pace and tolerates the exact reference on the next write (%s)', async architecture => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  const graph = workloadLifecycleFixture({ correction: true });
  graph.correctionIntents = [];
  graph.factLifecycles = graph.factLifecycles.filter(entry => entry.factId !== 'correction').map(entry => entry.factId === 'work'
    ? { ...entry, status: 'superseded', terminalRevision: 2, supersededByFactId: 'replacement' } : entry);
  const scope = { ownerId: 'lifecycle-owner', conversationId: 'lifecycle-synthetic', weekStartDate: '2026-10-05' };
  const planningState = { ...createInitialPlanningState(scope.weekStartDate), conversationArchitecture: architecture };
  expect(saveWeeklyPlanningStableV5PersistedSession({ ...scope, graph, planningState })).toBe(true);
  resetScriptedConversationRuntime();
  const loaded = loadWeeklyPlanningStableV5PersistedSession(scope)!;
  expect(loaded.graph).toEqual(graph);
  provider = installScriptedWeeklyPlanningProvider(call => call.kind === 'renderer' ? eventRendererReply(call) : JSON.stringify(eventDocument()));
  hydrateWeeklyPlanningStableV5RuntimeSession({ ...scope, graph: loaded.graph });
  const resumed = createScriptedConversation({ ...scope, provider, initialState: loaded.planningState });
  const turn = await resumed.submit('確認しました');
  expect(turn.result?.failure).toBeUndefined();
  const next = resumed.graph()!;
  expect(next.effortEstimates[0]).toEqual(graph.effortEstimates[0]);
  expect(weeklyPlanningIntroducedActiveFactReferenceErrorsV5({ originalGraph: graph, graph: next })).toEqual([]);
  expect(weeklyPlanningActiveFactReferenceErrorsV5(next)).toEqual(['graph.effortEstimates[0].targetFactId:target-not-active:work']);
  expect(saveWeeklyPlanningStableV5PersistedSession({ ...scope, graph: next, planningState: resumed.getState() })).toBe(true);
  expect(loadWeeklyPlanningStableV5PersistedSession(scope)?.graph).toEqual(next);
});
