import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

// Live round 5 X5 T2 (typed shape, synthetic): T1 {90, minute, target} with session_duration 45 attached to the WORKLOAD, split over two
// periods; T2 「やっぱり合計60分で足りそう」: correction 1 replaces the workload ({60, minute}), correction 2 replaces the session
// effort ({30}, target: the new workload). Correction 1's dependent migration supersedes the effort before correction 2 applies.
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const T1 = '今日の夜と明日の朝に分けて、数学の課題を合わせて90分やりたい';
const T2 = 'やっぱり合計60分で足りそう';
const T3 = 'やっぱり1回20分ずつにして';
const UNCHANGED = '今の仮予定は変えていません。';
const empty = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [],
  corrections: [], decisions: [], conversationActs: [], ...o });
const minutes = (localId: string, amount: number, sourceText: string): Json => ({ localId, quantityRole: 'target', amount, unitCode: 'minute',
  unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText });
const session = (localId: string, targetLocalId: string, m: number, sourceText: string): Json => ({ localId, targetLocalId, kind: 'session_duration',
  minutes: m, unitCode: null, precision: 'approximate', sourceText });
const window = (localId: string, dateExpression: string, namedTimePeriod: string, sourceText: string): Json => ({ localId, targetLocalId: 'task',
  kind: 'preferred_window', constraintLevel: 'soft', dateExpression, namedTimePeriod, startTime: null, endTime: null, precision: 'approximate', sourceText });
const task = (o: Json): Json => ({ localId: 'task', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '数学の課題',
  study: { purpose: 'self_study', activityKind: 'unknown', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
  temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '数学の課題を合わせて90分やりたい', ...o });
const target = (kind: string, publicId: string): Json => ({ kind, publicId, localId: null, mention: null });

const t1 = (): Json => empty({ planningIntent: 'create_plan', tasks: [task({
  workloads: [minutes('amt', 90, '合わせて90分')], effortEstimates: [session('each', 'amt', 45, '合わせて90分')],
  temporalConstraints: [window('w1', 'today', 'night', '今日の夜'), window('w2', 'tomorrow', 'morning', '明日の朝')],
  recurrence: [{ localId: 'split', targetLocalId: 'task', kind: 'custom', count: 2, days: [], sourceText: '今日の夜と明日の朝に分けて' }] })] });

interface Ids { taskId: string; workload: string; effort: string }
const idsOf = (summary: Json): Ids => ({
  taskId: String(((summary.tasks as Json[]) ?? [])[0].publicId),
  workload: String(((summary.workloads as Json[]) ?? [])[0].publicId),
  effort: String((((summary.effortEstimates as Json[]) ?? []).find(e => e.kind === 'session_duration'))!.publicId),
});
const shell = (ids: Ids, extra: Json) => task({ existingPublicId: ids.taskId, sourceText: T2, ...extra });
const c1 = (ids: Ids): Json => ({ localId: 'c1', target: target('workload', ids.workload), operation: 'replace', replacementLocalId: 'amt2', sourceText: 'やっぱり合計60分' });
const c2 = (ids: Ids): Json => ({ localId: 'c2', target: target('effort_estimate', ids.effort), operation: 'replace', replacementLocalId: 'each2', sourceText: 'やっぱり合計60分' });
const replacements = (): Json => ({ workloads: [minutes('amt2', 60, '合計60分')], effortEstimates: [session('each2', 'amt2', 30, '合計60分')] });

let captured: Ids | null = null;
function install(t2: (ids: Ids) => Json, t3?: (ids: Ids) => Json, architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') {
  const wire = (document: Json): string => JSON.stringify(architecture === 'legacy_v5'
    ? Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'conversationActs')) : document);
  captured = null;
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    const summary = (call.payload?.publicStateSummary ?? {}) as Json;
    if (text === T1) return wire(t1());
    if (text === T2) { captured = idsOf(summary); return wire(t2(captured)); }
    if (text === T3 && t3) return wire(t3(captured!));
    throw new Error(`unscripted: ${text}`);
  });
}
const open = (architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') => createScriptedConversation({ provider, architecture, weekStartDate: '2026-10-05', now: () => '2026-10-07T09:00:00.000Z' });
const live = (ids: Ids) => empty({ corrections: [c1(ids), c2(ids)], tasks: [shell(ids, replacements())] });
const reversed = (ids: Ids) => empty({ corrections: [c2(ids), c1(ids)], tasks: [shell(ids, replacements())] });
const view = (conv: ReturnType<typeof open>) => createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
const sessions = (conv: ReturnType<typeof open>) => view(conv).effortEstimates.filter(e => e.kind === 'session_duration');

describe('x9a: a correction whose target was superseded by a dependent migration earlier in the SAME transaction applies to the migrated fact', () => {
  it('RED (live X5 T2): workload replaced to 60 and its session replaced to 30 in one turn → 2 x 30 on the 60 workload', async () => {
    install(live);
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2);
    expect(second.result?.interactionOutcome?.kind).toBe('apply');
    expect(view(conv).workloads.map(w => w.amount)).toEqual([60]);
    expect(sessions(conv).map(e => e.minutes)).toEqual([30]);
    expect(sessions(conv)[0].targetFactId).toBe(view(conv).workloads[0].id);
    expect((second.result?.draftCandidates ?? []).map(c => (c as { durationMinutes?: number }).durationMinutes)).toEqual([30, 30]);
  });

  it('the corrections in the reverse order give the same result', async () => {
    install(reversed);
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2);
    expect(second.result?.interactionOutcome?.kind).toBe('apply');
    expect(view(conv).workloads.map(w => w.amount)).toEqual([60]);
    expect(sessions(conv).map(e => e.minutes)).toEqual([30]);
    expect(sessions(conv)[0].targetFactId).toBe(view(conv).workloads[0].id);
  });

  it('a target superseded in an EARLIER turn (by that turn\'s migration) is still rejected: disclosed recover, nothing changes', async () => {
    install(ids => empty({ corrections: [c1(ids)], tasks: [shell(ids, { workloads: [minutes('amt2', 60, '合計60分')] })] }),
      ids => empty({ corrections: [{ localId: 'c3', target: target('effort_estimate', ids.effort), operation: 'replace', replacementLocalId: 'each3', sourceText: T3 }],
        tasks: [task({ existingPublicId: ids.taskId, sourceText: T3, effortEstimates: [session('each3', 'task', 20, '1回20分')] })] }));
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2);
    expect(second.result?.interactionOutcome?.kind).toBe('apply');
    expect(sessions(conv).map(e => e.minutes)).toEqual([45]);
    const third = await conv.submit(T3);
    const results = third.debugTrace.filter(e => e.stage === 'runtime_semantic_result_received').map(e => JSON.stringify(e.data)).join('|');
    expect(results).toContain('not-active');
    expect(third.result?.interactionOutcome?.kind).toBe('recover');
    expect(third.result?.message).toContain(UNCHANGED);
    expect(sessions(conv).map(e => e.minutes)).toEqual([45]);
  });

  it('a target superseded in the same turn by anything other than a migration (two corrections of one effort) is still rejected', async () => {
    install(ids => empty({ corrections: [c2(ids), { ...c2(ids), localId: 'c2b', replacementLocalId: 'each3' }],
      tasks: [shell(ids, { effortEstimates: [session('each2', 'task', 30, '合計60分'), session('each3', 'task', 20, '合計60分')] })] }));
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2);
    expect(second.result?.interactionOutcome?.kind).toBe('recover');
    expect(sessions(conv).map(e => e.minutes)).toEqual([45]);
  });

  // EXPLICIT SHARED FIX: the canonical correction path is shared with legacy_v5, and the old legacy outcome depended on the
  // ORDER of the corrections (workload-first was a recover, effort-first applied). Same-turn corrections are now order-independent
  // across a dependent migration in both architectures. The legacy oracle has no such scenario, so it stays at 0 differing leaves.
  it.each([['live order (workload, then effort)', live], ['reversed order (effort, then workload)', reversed]] as const)('legacy_v5 (shared fix): %s applies 60 / 30', async (_name, reading) => {
    install(reading, undefined, 'legacy_v5');
    const conv = open('legacy_v5');
    await conv.submit(T1);
    await conv.submit(T2);
    expect(view(conv).workloads.map(w => w.amount)).toEqual([60]);
    expect(sessions(conv).map(e => e.minutes)).toEqual([30]);
    expect(sessions(conv)[0].targetFactId).toBe(view(conv).workloads[0].id);
  });
});

