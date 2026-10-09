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

const TEXT = '来週、物理の問題集を15問やりたい。物理は1問6分くらい';
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
const doc = (workloads: Json[], estimateTarget: string, unitCode: string, extra: Json = {}) => empty({ planningWindow: nextWeek, tasks: [task({ workloads,
  effortEstimates: [rate(estimateTarget, unitCode)], ...extra })] });
const minutesOf = (turn: { result: { draftCandidates: Array<{ durationMinutes?: number }> } | null }) =>
  (turn.result?.draftCandidates ?? []).reduce((sum, candidate) => sum + (candidate.durationMinutes ?? 0), 0);

describe('x8: a per-unit rate typed with a clock unitCode (live round 5 X2)', () => {
  it('control: the same rate typed with the workload\'s own unit gives a preview of 15 x 6 = 90 minutes and no question', async () => {
    install(doc([workload('amt', 15, 'problem', '問', '15問')], 'amt', 'problem'));
    const turn = await open().submit(TEXT);
    expect(turn.result?.draftCandidates.length).toBeGreaterThan(0);
    expect(minutesOf(turn)).toBeGreaterThanOrEqual(90);
  });

  it('RED (live): the rate typed with unitCode minute is taken for the problem workload: preview, no missing_effort_estimate question', async () => {
    install(doc([workload('amt', 15, 'problem', '問', '15問')], 'amt', 'minute'));
    const conv = open();
    const turn = await conv.submit(TEXT);
    expect(conv.getState().intakeState?.lastQuestionContext?.targetSlot ?? null).not.toBe('stable_v5:missing_effort_estimate');
    expect(turn.result?.draftCandidates.length).toBeGreaterThan(0);
    expect(minutesOf(turn)).toBeGreaterThanOrEqual(90);
  });
});
