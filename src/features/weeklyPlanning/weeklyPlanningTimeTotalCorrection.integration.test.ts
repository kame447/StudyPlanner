import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

// Live X5-T2 (synthetic typed shapes): T1 splits 90 minutes across tonight/tomorrow morning ({90, minute, target}, 2 x 45);
// T2 「やっぱり合計60分で足りそう」 corrects the accepted total. The model emitted three different typed shapes.
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
const session = (localId: string, targetLocalId: string, m: number, sourceText: string): Json => ({ localId, targetLocalId, kind: 'session_duration',
  minutes: m, unitCode: null, precision: 'approximate', sourceText });
const window = (localId: string, targetLocalId: string, dateExpression: string, namedTimePeriod: string, sourceText: string): Json => ({ localId,
  targetLocalId, kind: 'preferred_window', constraintLevel: 'soft', dateExpression, namedTimePeriod, startTime: null, endTime: null,
  precision: 'approximate', sourceText });
const task = (o: Json): Json => ({ localId: 'task', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '数学の課題',
  study: { purpose: 'self_study', activityKind: 'unknown', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
  temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '数学の課題を合わせて90分やりたい', ...o });

function t1(withTotalDuration: boolean, effortOn: string): Json {
  return empty({ planningIntent: 'create_plan', tasks: [task({
    workloads: [minutes('amt', 90, '合わせて90分')],
    effortEstimates: [session('each', effortOn, 45, '合わせて90分'),
      ...(withTotalDuration ? [{ localId: 'tot', targetLocalId: effortOn, kind: 'total_duration', minutes: 90, unitCode: null, precision: 'approximate', sourceText: '合わせて90分' }] : [])],
    temporalConstraints: [window('w1', 'task', 'today', 'night', '今日の夜'), window('w2', 'task', 'tomorrow', 'morning', '明日の朝')],
    recurrence: [{ localId: 'split', targetLocalId: 'task', kind: 'custom', count: 2, days: [], sourceText: '今日の夜と明日の朝に分けて' }] })] });
}

type Variant = 'r1' | 'r2' | 'r3';
function t2(variant: Variant, summary: Json): Json {
  const taskId = String(((summary.tasks as Json[]) ?? [])[0].publicId);
  const wl = String(((summary.workloads as Json[]) ?? [])[0].publicId);
  const efforts = (summary.effortEstimates as Json[]) ?? [];
  const eff = String((efforts.find(e => e.kind === 'session_duration') ?? efforts[0]).publicId);
  const target = (kind: string, publicId: string): Json => ({ kind, publicId, localId: null, mention: null });
  const shell = (extra: Json = {}): Json => task({ existingPublicId: taskId, sourceText: 'やっぱり合計60分で足りそう', ...extra });
  if (variant === 'r1') return empty({
    corrections: [
      { localId: 'c1', target: target('workload', wl), operation: 'replace', replacementLocalId: 'amt2', sourceText: 'やっぱり合計60分' },
      { localId: 'c2', target: target('effort_estimate', eff), operation: 'replace', replacementLocalId: 'each2', sourceText: 'やっぱり合計60分' }],
    tasks: [shell({ workloads: [minutes('amt2', 60, '合計60分')], effortEstimates: [session('each2', 'amt2', 30, '合計60分')] })] });
  if (variant === 'r2') return empty({
    corrections: [
      { localId: 'c1', target: target('workload', wl), operation: 'replace', replacementLocalId: null, sourceText: 'やっぱり合計60分' },
      { localId: 'c2', target: target('effort_estimate', eff), operation: 'replace', replacementLocalId: null, sourceText: 'やっぱり合計60分' }],
    tasks: [shell()] });
  return empty({
    corrections: [
      { localId: 'c1', target: target('workload', wl), operation: 'replace', replacementLocalId: null, sourceText: 'やっぱり合計60分' },
      { localId: 'c2', target: target('effort_estimate', eff), operation: 'replace', replacementLocalId: null, sourceText: 'やっぱり合計60分' }],
    tasks: [shell({ workloads: [minutes('amt2', 60, '合計60分')], effortEstimates: [session('each2', 'amt2', 30, '合計60分')] })] });
}

function install(variant: Variant, withTotalDuration: boolean, effortOn = 'amt'): void {
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    if (text === T1) return JSON.stringify(t1(withTotalDuration, effortOn));
    if (text === T2) return JSON.stringify(t2(variant, (call.payload?.publicStateSummary ?? {}) as Json));
    throw new Error(`unscripted: ${text}`);
  });
}
const open = () => createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-05', now: () => '2026-10-07T09:00:00.000Z' });

describe('X5-T2: a correction of an accepted time total', () => {
  it('replaces the workload and the session length together: the new total survives, the plan is recomputed (live r3)', async () => {
    install('r1', false, 'task');
    const conv = open();
    const first = await conv.submit(T1);
    expect(first.result?.draftCandidates.length).toBe(2);
    const second = await conv.submit(T2);
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
    expect(view.workloads.map(w => w.amount)).toEqual([60]);
    expect(view.effortEstimates.filter(e => e.kind === 'session_duration').map(e => e.minutes)).toEqual([30]);
    expect(conv.getState().intakeState?.lastQuestionContext?.targetSlot).not.toBe('stable_v5:missing_schedulable_work');
    expect(second.result?.draftCandidates.length).toBe(2);
  });


  it('control (live r2): replace corrections without any replacement fact change nothing and the turn is reported as not applied', async () => {
    install('r2', false, 'task');
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2);
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
    expect(second.result?.interactionOutcome?.kind).toBe('recover');
    expect(view.workloads.map(w => w.amount)).toEqual([90]);
    expect(view.effortEstimates.filter(e => e.kind === 'session_duration').map(e => e.minutes)).toEqual([45]);
  });
});

