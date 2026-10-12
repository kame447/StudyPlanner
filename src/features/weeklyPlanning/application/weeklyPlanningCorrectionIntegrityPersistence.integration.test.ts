import { projectStableV5CompatibilityState } from './weeklyPlanningStableV5CompatibilityState';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCorrectionIntegrityScenario, type CorrectionIntegrityScenario } from '../testUtils/__tests__/weeklyPlanningCorrectionIntegrityFixture';
import { createMemoryStorageHarness } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { getWeeklyPlanningStableV5SessionStorageKeyForTest, loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionStorage';
import { hydrateWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { workloadLifecycleFixture } from '../testUtils/__tests__/weeklyPlanningWorkloadLifecycleFixture';
import { finalizeWeeklyPlanningSemanticCanonicalizationV5 } from '../semantic/weeklyPlanningSemanticCommitV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { eventDocument } from '../testUtils/__tests__/weeklyPlanningCorrectionIntegrityFixture';

const ownerId = 'integrity-owner';
const weekStartDate = '2026-10-05';
const conversationId = 'lifecycle-synthetic';
const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(ownerId, weekStartDate);
afterEach(() => { vi.unstubAllGlobals(); resetWeeklyPlanningStableV5RuntimeSessionsForTest(); });

describe('accepted correction identity crosses the real session codec/storage boundary', () => {
  it.each<CorrectionIntegrityScenario>(['role-rate', 'role-session', 'role-total', 'paired-session', 'paired-total', 'window-changed', 'window-identical', 'window-cross-kind'])('round-trips %s and refuses a repeated turn without duplicates', async scenario => {
    const storage = createMemoryStorageHarness();
    vi.stubGlobal('window', { localStorage: storage.storage });
    const { result, originalGraph, pipeline, common, requestId, pendingQuestion } = await runCorrectionIntegrityScenario(scenario);
    expect(result.canonicalization?.status, result.canonicalization?.errors.join('|')).toBe('applied');
    const planningState = createInitialPlanningState(weekStartDate);
    if (pendingQuestion?.questionCode === 'semantic_uncertainty') {
      const carry = result.graph.factLifecycles.some(entry => entry.factId === pendingQuestion.targetFactId && entry.status === 'active');
      planningState.intakeState = projectStableV5CompatibilityState({ userText: 'synthetic answer', message: 'synthetic pending question', draftCandidates: [], authorized: false,
        ...(carry ? { questionCode: 'semantic_uncertainty', questionFactId: pendingQuestion.targetFactId!, questionActionId: 'question' } : {}) });
    }
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId, weekStartDate, conversationId, graph: result.graph, planningState })).toBe(true);
    const raw = storage.values.get(key);
    const restored = loadWeeklyPlanningStableV5PersistedSession({ ownerId, weekStartDate });
    expect(restored?.graph).toEqual(result.graph);
    expect(restored?.planningState.intakeState?.lastQuestionContext).toEqual(planningState.intakeState?.lastQuestionContext);
    expect(storage.values.get(key)).toBe(raw);
    const hydrated = hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId, weekStartDate, conversationId, graph: restored!.graph });
    expect(hydrated.graph).toEqual(result.graph);
    const repeated = await pipeline.run({ ...common, graph: restored!.graph, turnId: requestId, expectedRevision: restored!.graph.revision,
      publicStateSummary: pendingQuestion ? { pendingQuestion } : {} });
    expect(repeated.status).toBe('duplicate_turn');
    expect(repeated.canonicalization?.status).toBe('duplicate');
    expect(repeated.graph).toEqual(restored!.graph);
    expect(repeated.graph.workloads.length).toBe(result.graph.workloads.length);
    expect(repeated.graph.effortEstimates.length).toBe(result.graph.effortEstimates.length);
    if (pendingQuestion?.questionCode === 'semantic_uncertainty') {
      const restoredQuestion = restored!.graph.uncertainties.find(fact => fact.id === pendingQuestion.targetFactId);
      expect(restoredQuestion?.id).toBe(originalGraph.uncertainties[0].id);
      expect(restored!.graph.factLifecycles.find(entry => entry.factId === restoredQuestion!.id)?.status).toBe(scenario === 'window-changed' ? 'removed' : 'active');
    }
  });

  it('reads historical inactive references without rewriting bytes and returns the original graph on finalizer rejection', () => {
    const storage = createMemoryStorageHarness();
    vi.stubGlobal('window', { localStorage: storage.storage });
    const original = workloadLifecycleFixture({ correction: true });
    const old = original.factLifecycles.find(entry => entry.factId === 'work')!;
    Object.assign(old, { status: 'superseded', terminalRevision: 2, supersededByFactId: 'replacement' });
    const planningState = createInitialPlanningState(weekStartDate);
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId, weekStartDate, conversationId, graph: original, planningState })).toBe(true);
    const raw = storage.values.get(key);
    const restored = loadWeeklyPlanningStableV5PersistedSession({ ownerId, weekStartDate })!;
    expect(restored.graph).toEqual(original);
    expect(storage.values.get(key)).toBe(raw);
    const graph = structuredClone(restored.graph);
    graph.revision++;
    graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'new-bad', createdRevision: graph.revision });
    graph.factLifecycles.push({ factId: 'new-bad', status: 'active', createdRevision: graph.revision, terminalRevision: null, supersededByFactId: null });
    const committed = finalizeWeeklyPlanningSemanticCanonicalizationV5({ originalGraph: restored.graph, document: eventDocument() as unknown as WeeklyPlanningSemanticDocumentV5,
      baseCanonicalization: { status: 'applied', graph, localToFactId: {}, errors: [], diff: { fromRevision: original.revision, toRevision: graph.revision,
        added: [{ kind: 'effort_estimate', id: 'new-bad' }], superseded: [], removed: [] } }, contextualAnswer: false, questionCode: null, operationKeyPrefix: 'persist-invalid' });
    expect(committed.canonicalization.status).toBe('rejected');
    expect(committed.canonicalization.graph).toBe(restored.graph);
    expect(committed.canonicalization.diff).toBeNull();
    expect(storage.values.get(key)).toBe(raw);
  });
});
