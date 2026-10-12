import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decideWeeklyPlanningStableDialogueV5, listWeeklyPlanningStableBlockingQuestionsV5 } from './weeklyPlanningStableDialoguePolicyV5';
import { decideWeeklyPlanningStableRepairPolicyV5 } from './weeklyPlanningStableRepairPolicyV5';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';
import { runRequiredUncertaintyRateFixture } from '../testUtils/__tests__/weeklyPlanningRequiredUncertaintyFixture';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No provider/network in this typed regression'); })); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); resetWeeklyPlanningStableV5DebugTraceForTest(); });

describe('required question and independent detail are separate canonical responsibilities', () => {
  it.each([true, false])('keeps the exact material question and 3-minute/problem rate (question relisted: %s)', async relisted => {
    const { initial, before, second, after, originalNeed, originalGraphBytes } = await runRequiredUncertaintyRateFixture(relisted);
    expect(JSON.stringify(initial.graph)).toBe(originalGraphBytes);
    expect(second.canonicalization?.status, JSON.stringify(second)).toBe('applied');
    expect(second.scheduler?.status).toBe('needs_resolution');
    expect(after.tasks).toEqual(before.tasks);
    expect(after.workloads).toEqual(before.workloads);
    expect(after.components).toEqual([]);
    expect(second.graph.correctionIntents).toEqual(initial.graph.correctionIntents);
    expect(second.graph.decisionIntents).toEqual(initial.graph.decisionIntents);
    expect(after.effortEstimates).toEqual([expect.objectContaining({ targetFactId: before.workloads[0].id, kind: 'duration_per_unit', minutes: 3, unitCode: 'problem' })]);
    expect(after.uncertainties).toContainEqual(originalNeed);
    // Ordinary canonicalization retains the repeated fact as well; no generic
    // deduplication or hidden question-release policy is introduced here.
    expect(after.uncertainties).toHaveLength(relisted ? 2 : 1);
    expect(second.canonicalization?.diff?.removed).toEqual([]);
    expect(listWeeklyPlanningStableBlockingQuestionsV5(second.scheduler!)).toContainEqual(expect.objectContaining({ code: 'semantic_uncertainty', factId: originalNeed.id }));
    expect(decideWeeklyPlanningStableDialogueV5(second.scheduler!)).toMatchObject({ status: 'ask_question', question: { code: 'semantic_uncertainty', factId: originalNeed.id }, previewEligible: false });
    expect(decideWeeklyPlanningStableRepairPolicyV5({ graph: second.graph, compilation: second.scheduler!, previousAgenda: [], graphRevision: second.graph.revision, turnId: 'rate-answer' })).toMatchObject({ mode: 'explicit_repair', question: { factId: originalNeed.id }, deferredIssueIds: [] });
  });
});
