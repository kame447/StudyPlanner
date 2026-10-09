import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

// Live round 5 X2 (167751ca, typed shape, synthetic): 「来週、物理の問題集を15問やりたい。物理は1問6分くらい」. The reading has the workload
// {15, problem, target} and the rate {duration_per_unit, 6, unitCode: 'minute'} (the unit should be `problem`): the clock unit
// is the unit of the 6, not of the counted work. The estimate ignores a rate whose unit differs from the workload's, so the app
// asks for the rate again without saying it was not taken in.
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const TEXT = '来週、物理の問題集を15問やりたい。物理は1問6分くらい。参考書を10ページ読む';
const empty = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [],
  corrections: [], decisions: [], conversationActs: [], ...o });
const nextWeek = { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
const workload = (localId: string, amount: number, unitCode: string, unitLabel: string, sourceText: string): Json => ({ localId, quantityRole: 'target', amount,
  unitCode, unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText });
const rate = (targetLocalId: string, unitCode: string): Json => ({ localId: 'rate', targetLocalId, kind: 'duration_per_unit', minutes: 6, unitCode,
  precision: 'approximate', sourceText: '物理は1問6分くらい' });
const task = (o: Json): Json => ({ localId: 'phys', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '物理の問題集',
  study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
  temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '物理の問題集を15問', ...o });

function install(document: Json, architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1'): void {
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    if (text === TEXT) {
      const wire = architecture === 'legacy_v5' ? Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'conversationActs')) : document;
      return JSON.stringify(wire);
    }
    throw new Error(`unscripted: ${text}`);
  });
}
const open = (architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') => createScriptedConversation({ provider, architecture, weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
const doc = (workloads: Json[], estimateTarget: string, unitCode: string, extra: Json = {}, minutes = 6) => empty({ planningWindow: nextWeek, tasks: [task({ workloads,
  effortEstimates: [{ ...rate(estimateTarget, unitCode), minutes }], ...extra })] });
const minutesOf = (turn: { result: { draftCandidates: Array<{ durationMinutes?: number }> } | null }) =>
  (turn.result?.draftCandidates ?? []).reduce((sum, candidate) => sum + (candidate.durationMinutes ?? 0), 0);

const PROJECTED = '「物理は1問6分くらい」は、問あたり6分として使いました。';
const slot = (conv: ReturnType<typeof open>) => conv.getState().intakeState?.lastQuestionContext?.targetSlot ?? null;
const allocated = (turn: { result: { communicationFacts?: unknown } | null }) =>
  ((turn.result?.communicationFacts as { allocationBreakdown?: { estimatedMinutes: number } } | undefined)?.allocationBreakdown?.estimatedMinutes) ?? null;

describe('x8: a per-unit rate typed with a clock unitCode (live round 5 X2)', () => {
  it('control: the same rate typed with the workload\'s own unit gives a preview of 15 x 6 = 90 minutes, no question and no rate sentence', async () => {
    install(doc([workload('amt', 15, 'problem', '問', '15問')], 'amt', 'problem'));
    const turn = await open().submit(TEXT);
    expect(turn.result?.draftCandidates.length).toBeGreaterThan(0);
    expect(minutesOf(turn)).toBeGreaterThanOrEqual(90);
    expect(turn.result?.message).not.toContain('あたり6分として使いました');
    expect(turn.result?.message).not.toContain('合わなかったため');
  });

  it('live X2 (a): the rate typed with unitCode minute is used as 6 minutes per problem, the app says so once, no rate question; later turns do not re-ask', async () => {
    install(doc([workload('amt', 15, 'problem', '問', '15問')], 'amt', 'minute'));
    const conv = open();
    const turn = await conv.submit(TEXT);
    expect(slot(conv)).not.toBe('stable_v5:missing_effort_estimate');
    expect(turn.result?.draftCandidates.length).toBeGreaterThan(0);
    expect(minutesOf(turn)).toBeGreaterThanOrEqual(90);
    expect(allocated(turn)).toBe(90);
    expect(turn.result?.communicationFacts?.rateUnitProjected).toEqual({ quote: '物理は1問6分くらい', minutes: 6, unitLabel: '問' });
    expect(turn.result?.message).toContain(PROJECTED);
    expect((turn.result?.message ?? '').split(PROJECTED).length).toBe(2);
    expect(turn.result?.message).not.toContain('合わなかったため');
  });

  it('the hour variant ({6, hour}) is the same live phrasing pattern: 6 minutes per problem, disclosed', async () => {
    install(doc([workload('amt', 15, 'problem', '問', '15問')], 'amt', 'hour'));
    const conv = open();
    const turn = await conv.submit(TEXT);
    expect(slot(conv)).not.toBe('stable_v5:missing_effort_estimate');
    expect(allocated(turn)).toBe(90);
    expect(turn.result?.message).toContain(PROJECTED);
  });

  it('a task-level target with exactly one workload is projected too (disclosed)', async () => {
    install(doc([workload('amt', 15, 'problem', '問', '15問')], 'phys', 'minute'));
    const conv = open();
    const turn = await conv.submit(TEXT);
    expect(slot(conv)).not.toBe('stable_v5:missing_effort_estimate');
    expect(turn.result?.message).toContain(PROJECTED);
  });

  it('DOCUMENTED RESIDUAL (mis-encoding {60, hour} on {10, page}, 「1時間で10ページ」): the plan shows 600 minutes AND the interpretation is stated, so it is visible and correctable', async () => {
    install(doc([workload('amt', 10, 'page', 'ページ', '10ページ')], 'amt', 'hour', {}, 60));
    const conv = open();
    const turn = await conv.submit(TEXT);
    expect(slot(conv)).not.toBe('stable_v5:missing_effort_estimate');
    expect(allocated(turn)).toBe(600);
    expect(turn.result?.message).toContain('「物理は1問6分くらい」は、ページあたり60分として使いました。');
  });

  it('a non-clock mismatch ({5, page} on {15, problem}) is untouched: the app asks for the rate and says the given one could not be used', async () => {
    install(doc([workload('amt', 15, 'problem', '問', '15問')], 'amt', 'page', {}, 5));
    const conv = open();
    const turn = await conv.submit(TEXT);
    expect(slot(conv)).toBe('stable_v5:missing_effort_estimate');
    expect(turn.result?.communicationFacts?.rateUnitProjected).toBeUndefined();
    expect(turn.result?.communicationFacts?.ignoredRate).toEqual({ quote: '物理は1問6分くらい', unit: '問' });
    expect(turn.result?.message).toContain('「物理は1問6分くらい」は、この作業の単位（問）と合わなかったため使えませんでした。');
    expect((turn.result?.message ?? '').split('合わなかったため').length).toBe(2);
  });

  it('critic shape 1: a clock rate on a task with several workloads is ambiguous, untouched, and disclosed as not usable', async () => {
    install(doc([workload('amt', 15, 'problem', '問', '15問'), workload('amt2', 10, 'page', 'ページ', '10ページ')], 'phys', 'minute'));
    const conv = open();
    const turn = await conv.submit(TEXT);
    expect(slot(conv)).toBe('stable_v5:missing_effort_estimate');
    expect(turn.result?.communicationFacts?.rateUnitProjected).toBeUndefined();
    expect(turn.result?.message).toContain('合わなかったため使えませんでした');
  });

  it('a clock-unit workload ({30, minute} with a clock rate) is untouched and carries no rate sentence', async () => {
    install(doc([workload('amt', 30, 'minute', '分', '30分')], 'amt', 'minute'));
    const turn = await open().submit(TEXT);
    expect(turn.result?.communicationFacts?.rateUnitProjected).toBeUndefined();
    expect(turn.result?.message).not.toContain('あたり6分として使いました');
    expect(turn.result?.message).not.toContain('合わなかったため');
  });

  it('legacy_v5 control: the live X2 shape is unchanged (the rate is still re-asked, no rate sentence)', async () => {
    install(doc([workload('amt', 15, 'problem', '問', '15問')], 'amt', 'minute'), 'legacy_v5');
    const conv = open('legacy_v5');
    const turn = await conv.submit(TEXT);
    expect(slot(conv)).toBe('stable_v5:missing_effort_estimate');
    expect(turn.result?.communicationFacts?.rateUnitProjected).toBeUndefined();
    expect(turn.result?.message).not.toContain('あたり6分として使いました');
  });
});
