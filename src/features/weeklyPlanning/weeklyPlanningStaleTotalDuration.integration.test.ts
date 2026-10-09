import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

// X5g: a task-level total_duration 90 beside the target {90 minute} workload. T2 corrects only the workload (90->60) and the
// session (45->30). Does the stale total_duration stay active and change what the user gets? (synthetic typed shapes)
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const T1 = '今日の夜と明日の朝に分けて、数学の課題を合わせて90分やりたい';
const T2 = 'やっぱり合計60分で足りそう';

const empty = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [],
  corrections: [], decisions: [], conversationActs: [], ...o });
const minutes = (localId: string, amount: number, sourceText: string): Json => ({ localId, quantityRole: 'target', amount, unitCode: 'minute',
  unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText });
const effort = (localId: string, targetLocalId: string, kind: string, m: number, sourceText: string): Json => ({ localId, targetLocalId, kind,
  minutes: m, unitCode: null, precision: 'approximate', sourceText });
const window = (localId: string, dateExpression: string, namedTimePeriod: string, sourceText: string): Json => ({ localId, targetLocalId: 'task',
  kind: 'preferred_window', constraintLevel: 'soft', dateExpression, namedTimePeriod, startTime: null, endTime: null, precision: 'approximate', sourceText });
const task = (o: Json): Json => ({ localId: 'task', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '数学の課題',
  study: { purpose: 'self_study', activityKind: 'unknown', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
  temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '数学の課題を合わせて90分やりたい', ...o });

type On = 'task' | 'workload';
const t1 = (on: On, withTotal: boolean): Json => empty({ planningIntent: 'create_plan', tasks: [task({
  workloads: [minutes('amt', 90, '合わせて90分')],
  effortEstimates: [...(withTotal ? [effort('tot', on === 'task' ? 'task' : 'amt', 'total_duration', 90, '合わせて90分')] : []), effort('each', on === 'task' ? 'task' : 'amt', 'session_duration', 45, '合わせて90分')],
  temporalConstraints: [window('w1', 'today', 'night', '今日の夜'), window('w2', 'tomorrow', 'morning', '明日の朝')],
  recurrence: [{ localId: 'split', targetLocalId: 'task', kind: 'custom', count: 2, days: [], sourceText: '今日の夜と明日の朝に分けて' }] })] });

function t2(summary: Json): Json {
  const taskId = String(((summary.tasks as Json[]) ?? [])[0].publicId);
  const wl = String(((summary.workloads as Json[]) ?? [])[0].publicId);
  const eff = String((((summary.effortEstimates as Json[]) ?? []).find(e => e.kind === 'session_duration'))!.publicId);
  const target = (kind: string, publicId: string): Json => ({ kind, publicId, localId: null, mention: null });
  return empty({
    corrections: [
      { localId: 'c1', target: target('workload', wl), operation: 'replace', replacementLocalId: 'amt2', sourceText: 'やっぱり合計60分' },
      { localId: 'c2', target: target('effort_estimate', eff), operation: 'replace', replacementLocalId: 'each2', sourceText: 'やっぱり合計60分' }],
    tasks: [task({ existingPublicId: taskId, sourceText: T2, workloads: [minutes('amt2', 60, '合計60分')], effortEstimates: [effort('each2', 'amt2', 'session_duration', 30, '合計60分')] })] });
}

function install(on: On, withTotal = true): void {
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    if (text === T1) return JSON.stringify(t1(on, withTotal));
    if (text === T2) return JSON.stringify(t2((call.payload?.publicStateSummary ?? {}) as Json));
    throw new Error(`unscripted: ${text}`);
  });
}
const open = () => createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-05', now: () => '2026-10-07T09:00:00.000Z' });

const UNCHANGED = '今の仮予定は変えていません。';
const blocks = (r: { result: { draftCandidates?: unknown[] } | null }) => (r.result?.draftCandidates ?? [])
  .map(c => { const b = c as { date?: string; startTime?: string; endTime?: string; durationMinutes?: number }; return `${b.date} ${b.startTime}-${b.endTime} ${b.durationMinutes}`; }).sort();

describe('X5g: a task-level total_duration 90 beside the corrected target workload', () => {
  it('is inert for the user: the corrected plan equals the plan of a graph that never had it (2 x 30 = 60, margin 0, no question, no disclosure)', async () => {
    install('task', true);
    const withTotal = open();
    await withTotal.submit(T1);
    const second = await withTotal.submit(T2);
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(withTotal.graph()!);
    expect(view.workloads.map(w => w.amount)).toEqual([60]);
    expect(second.result?.interactionOutcome?.kind).toBe('apply');
    expect(withTotal.getState().intakeState?.lastQuestionContext?.targetSlot ?? null).toBeNull();
    const facts = second.result?.communicationFacts as { allocationBreakdown?: { allocatedMinutes: number; marginMinutes: number }; previewDisclosure?: unknown } | undefined;
    expect(facts?.allocationBreakdown).toMatchObject({ allocatedMinutes: 60, marginMinutes: 0 });
    expect(facts?.previewDisclosure ?? null).toBeNull();
    const shown = blocks(second);
    expect(shown).toHaveLength(2);
    expect(shown.every(b => b.endsWith(' 30'))).toBe(true);
    provider.restore(); resetScriptedConversationRuntime();

    install('task', false);
    const without = open();
    await without.submit(T1);
    const control = await without.submit(T2);
    expect(blocks(control)).toEqual(shown);
  });

  it('with the session effort on the workload the turn is rejected by dependent migration (known X5c residual): disclosed recover, nothing changes', async () => {
    install('workload', true);
    const conv = open();
    const first = await conv.submit(T1);
    const second = await conv.submit(T2);
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
    const results = second.debugTrace.filter(e => e.stage === 'runtime_semantic_result_received').map(e => JSON.stringify(e.data)).join('|');
    expect(results).toContain('target-fact-not-active');
    expect(second.result?.interactionOutcome?.kind).toBe('recover');
    expect(second.result?.message).toContain(UNCHANGED);
    expect(view.workloads.map(w => w.amount)).toEqual([90]);
    expect(blocks(second)).toEqual([]);
    expect(conv.getState().previewCandidates?.length).toBe(blocks(first).length);
  });
});
