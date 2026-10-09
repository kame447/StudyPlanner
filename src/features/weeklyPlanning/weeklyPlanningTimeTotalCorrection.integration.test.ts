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
const T1C = '数学の課題の第2章を、今日の夜と明日の朝に分けて合わせて90分やりたい';
const T2C = '第2章じゃなくて第3章の分だった';
const UNCHANGED_SENTENCE = '今の仮予定は変えていません。';
const T2R = '数学の課題じゃなくて数学の宿題で、合計60分だった';
const T2S = 'やっぱり数学の課題は合計60分だった';
const T2B = '数学の課題90分は、1回30分ずつにして';

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

const comp = (localId: string, label: string, workloads: Json[], sourceText: string): Json => ({ localId, existingPublicId: null, parentLocalId: null,
  role: 'section', label, workloads, durableContextSignals: [], sourceText });
function t1Chapter(): Json {
  return empty({ planningIntent: 'create_plan', tasks: [task({ sourceText: T1C,
    study: { purpose: 'self_study', activityKind: 'unknown', contextLabel: null, components: [comp('ch2', '第2章', [minutes('amt', 90, '合わせて90分')], '第2章')] },
    effortEstimates: [session('each', 'task', 45, '合わせて90分')],
    temporalConstraints: [window('w1', 'task', 'today', 'night', '今日の夜'), window('w2', 'task', 'tomorrow', 'morning', '明日の朝')],
    recurrence: [{ localId: 'split', targetLocalId: 'task', kind: 'custom', count: 2, days: [], sourceText: '今日の夜と明日の朝に分けて' }] })] });
}

type Variant = 'r1' | 'dangling' | 'c2only' | 'additive' | 'stub' | 'chapter' | 'rename' | 'sameTitle';
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
  if (variant === 'dangling') return empty({
    // The live r2 shape: both replacement ids name no fact.
    corrections: [
      { localId: 'correction_workload_total', target: target('workload', wl), operation: 'replace', replacementLocalId: 'workload_math_60', sourceText: 'やっぱり合計60分' },
      { localId: 'correction_effort_session', target: target('effort_estimate', eff), operation: 'replace', replacementLocalId: 'effort_math_session_30', sourceText: 'やっぱり合計60分' }],
    tasks: [shell()] });
  if (variant === 'rename' || variant === 'sameTitle') return empty({
    // Critic probe 30: the replacement workload sits in a NEW task container (no existingPublicId); 'rename' retitles the task.
    corrections: [{ localId: 'c1', target: target('workload', wl), operation: 'replace', replacementLocalId: 'amt2', sourceText: '合計60分だった' }],
    tasks: [task({ localId: 'taskNew', existingPublicId: null, title: variant === 'rename' ? '数学の宿題' : '数学の課題',
      sourceText: variant === 'rename' ? T2R : T2S, workloads: [minutes('amt2', 60, '合計60分')] })] });
  if (variant === 'chapter') return empty({
    // Critic probe 29: the workload is said to belong to chapter 3; the replacement sits in a NEW component.
    corrections: [{ localId: 'c1', target: target('workload', wl), operation: 'replace', replacementLocalId: 'amt3', sourceText: T2C }],
    tasks: [shell({ sourceText: T2C, study: { purpose: 'self_study', activityKind: 'unknown', contextLabel: null,
      components: [comp('ch3', '第3章', [minutes('amt3', 90, '第3章の分')], '第3章')] } })] });
  if (variant === 'stub') return empty({
    // A pure re-declaration of the accepted 90-minute total that the corrected session hangs from (a real stub): entity binding matches it.
    corrections: [{ localId: 'c2', target: target('effort_estimate', eff), operation: 'replace', replacementLocalId: 'each2', sourceText: '1回30分ずつ' }],
    tasks: [shell({ sourceText: T2B, workloads: [minutes('amtDup', 90, '数学の課題90分')], effortEstimates: [session('each2', 'amtDup', 30, '1回30分ずつ')] })] });
  if (variant === 'additive') return empty({
    // A genuinely additive new workload with no correction at all.
    tasks: [shell({ workloads: [minutes('amt3', 20, '合計60分')] })] });
  // c2only (critic probe 28): only the session is corrected; the new 60-minute total is a plain new fact it hangs from.
  return empty({
    corrections: [{ localId: 'c2', target: target('effort_estimate', eff), operation: 'replace', replacementLocalId: 'each2', sourceText: 'やっぱり合計60分' }],
    tasks: [shell({ workloads: [minutes('amt2', 60, '合計60分')], effortEstimates: [session('each2', 'amt2', 30, '合計60分')] })] });
}

let lastT2: string | null = null;
let lastSummary: Json = {};
let compliantRepair = false;
let legacyDocuments = false;
/** Legacy documents carry no conversationActs (the legacy schema is closed). */
const wire = (document: Json): string => JSON.stringify(legacyDocuments ? Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'conversationActs')) : document);
function install(variant: Variant, withTotalDuration: boolean, effortOn = 'amt'): void {
  lastT2 = null;
  compliantRepair = false;
  legacyDocuments = false;
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    if (text === T1) return wire(t1(withTotalDuration, effortOn));
    if (text === T1C) return JSON.stringify(t1Chapter());
    if (text === T2 || text === T2B || text === T2C || text === T2R || text === T2S) { lastSummary = (call.payload?.publicStateSummary ?? {}) as Json; lastT2 = wire(t2(variant, lastSummary)); return lastT2; }
    if (compliantRepair && call.kind === 'semantic_generic') return JSON.stringify(t2('r1', lastSummary));
    // The repair payload carries no userText: the model returns the identical shape (as observed live).
    if (lastT2 !== null && call.kind === 'semantic_generic') return lastT2;
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


  it('control (live r2): dangling replacement ids go through the one scripted repair and recover with the plan unchanged', async () => {
    install('dangling', false, 'task');
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2);
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
    const errors = second.debugTrace.filter(e => e.stage === 'semantic_validation_result').map(e => JSON.stringify(e.data)).join('|');
    expect(errors).toContain('replacementLocalId:unknown:workload_math_60');
    expect(errors).toContain('replacementLocalId:unknown:effort_math_session_30');
    expect(second.calls.filter(c => c.kind === 'semantic_generic').length).toBe(2);
    expect(second.result?.interactionOutcome?.kind).toBe('recover');
    expect(second.result?.message).toContain(UNCHANGED_SENTENCE);
    expect(view.workloads.map(w => w.amount)).toEqual([90]);
    expect(view.effortEstimates.filter(e => e.kind === 'session_duration').map(e => e.minutes)).toEqual([45]);
    expect(conv.getState().previewCandidates?.length).toBe(2);
  });

  it('critic probe 28: only the session is corrected and the new 60-minute total hangs from it - the turn is never applied with the 90 total', async () => {
    install('c2only', false, 'task');
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2);
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
    // The user's 60 is either installed or the turn is disclosed as not applied; it is never dropped silently.
    const dropped = !view.workloads.some(w => w.amount === 60);
    expect(dropped && second.result?.interactionOutcome?.kind === 'apply').toBe(false);
    expect(second.result?.interactionOutcome?.kind).toBe('recover');
    expect(second.result?.message).toContain(UNCHANGED_SENTENCE);
    expect(view.workloads.map(w => w.amount)).toEqual([90]);
    expect(view.effortEstimates.filter(e => e.kind === 'session_duration').map(e => e.minutes)).toEqual([45]);
  });

  it('probe 28 with a scripted compliant repair (adds the workload correction): the correct 60/30 is applied in two calls', async () => {
    install('c2only', false, 'task');
    compliantRepair = true;
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2);
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
    const errors = second.debugTrace.filter(e => e.stage === 'semantic_validation_result').map(e => JSON.stringify(e.data)).join('|');
    expect(errors).toContain('replacementLocalId:support-not-installed:amt2');
    expect(second.calls.filter(c => c.kind === 'semantic_generic').length).toBe(2);
    expect(view.workloads.map(w => w.amount)).toEqual([60]);
    expect(view.effortEstimates.filter(e => e.kind === 'session_duration').map(e => e.minutes)).toEqual([30]);
    expect(second.result?.draftCandidates.length).toBe(2);
  });

  it('control (unchanged path): an identical restatement of the accepted total is matched by binding and still rejected as before, disclosed', async () => {
    install('stub', false, 'task');
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2B);
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
    const rejected = second.debugTrace.filter(e => e.stage === 'runtime_semantic_result_received').map(e => JSON.stringify(e.data)).join('|');
    expect(rejected).toContain('replacement-support-not-created-in-turn');
    expect(second.result?.interactionOutcome?.kind).toBe('recover');
    expect(second.result?.message).toContain(UNCHANGED_SENTENCE);
    expect(view.workloads.map(w => w.amount)).toEqual([90]);
    expect(view.effortEstimates.filter(e => e.kind === 'session_duration').map(e => e.minutes)).toEqual([45]);
  });

  it('false-positive control: an additive new workload with no effort-replace correction raises no support error and is installed', async () => {
    install('additive', false, 'task');
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2);
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
    const errors = second.debugTrace.filter(e => e.stage === 'semantic_validation_result').map(e => JSON.stringify(e.data)).join('|');
    expect(errors).not.toContain('support-not-installed');
    expect(view.workloads.map(w => w.amount).sort((a, b) => a - b)).toEqual([20, 90]);
  });

  it('critic probe 29: a replacement placed in a new component 第3章 is never silently deleted - disclosed recover, plan unchanged (canonical layer only)', async () => {
    install('chapter', false, 'task');
    const conv = open();
    const first = await conv.submit(T1C);
    expect(first.result?.draftCandidates.length).toBe(2);
    const second = await conv.submit(T2C);
    const errors = second.debugTrace.filter(e => e.stage === 'semantic_validation_result').map(e => JSON.stringify(e.data)).join('|');
    expect(errors).not.toContain('support-not-installed');
    const rejected = second.debugTrace.filter(e => e.stage === 'runtime_semantic_result_received').map(e => JSON.stringify(e.data)).join('|');
    expect(rejected).toContain('replacement-container-not-installed');
    expect(second.result?.interactionOutcome?.kind).toBe('recover');
    expect(second.result?.message).toContain(UNCHANGED_SENTENCE);
    const g = conv.graph()!;
    const active = new Set(g.factLifecycles.filter(l => l.status === 'active').map(l => l.factId));
    expect(g.components.filter(c => active.has(c.id)).map(c => c.label)).toEqual(['第2章']);
    expect(conv.getState().previewCandidates?.length).toBe(2);
  });

  it('critic probe 30: a rename inside a new task container is never silently lost - disclosed recover, the task keeps its title and the plan is unchanged', async () => {
    install('rename', false, 'task');
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2R);
    const errors = second.debugTrace.filter(e => e.stage === 'semantic_validation_result').map(e => JSON.stringify(e.data)).join('|');
    expect(errors).not.toContain('existing-task-binding-required');
    const rejected = second.debugTrace.filter(e => e.stage === 'runtime_semantic_result_received').map(e => JSON.stringify(e.data)).join('|');
    expect(rejected).toContain('replacement-container-not-installed');
    expect(second.result?.interactionOutcome?.kind).toBe('recover');
    expect(second.result?.message).toContain(UNCHANGED_SENTENCE);
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
    expect(view.tasks.map(t => t.title)).toEqual(['数学の課題']);
    expect(view.workloads.map(w => w.amount)).toEqual([90]);
  });

  it('control: a container restating the same title is stopped at validation (existing-task-binding-required), as before', async () => {
    install('sameTitle', false, 'task');
    const conv = open();
    await conv.submit(T1);
    const second = await conv.submit(T2S);
    const errors = second.debugTrace.filter(e => e.stage === 'semantic_validation_result').map(e => JSON.stringify(e.data)).join('|');
    expect(errors).toContain('existing-task-binding-required');
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
    expect(view.workloads.map(w => w.amount)).toEqual([90]);
  });

  it('legacy_v5 (real legacy turn, T1 succeeds): the c2-only shape is rejected by the shared canonical rule, nothing applied', async () => {
    install('c2only', false, 'task');
    legacyDocuments = true;
    const conv = createScriptedConversation({ provider, architecture: 'legacy_v5', weekStartDate: '2026-10-05', now: () => '2026-10-07T09:00:00.000Z' });
    const first = await conv.submit(T1);
    const second = await conv.submit(T2);
    const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conv.graph()!);
    const results = second.debugTrace.filter(e => e.stage === 'runtime_semantic_result_received').map(e => JSON.stringify(e.data)).join('|');
    expect(first.result?.draftCandidates.length).toBe(2);
    // The canonical rule is shared with legacy: the c2-only turn is rejected (legacy's own disclosure), nothing is applied.
    expect(results).toContain('"status":"canonicalization_rejected"');
    expect(results).toContain('replacement-support-not-installed');
    expect(second.result?.message).toContain('変更は反映していません');
    expect(view.workloads.map(w => w.amount)).toEqual([90]);
    expect(view.effortEstimates.filter(e => e.kind === 'session_duration').map(e => e.minutes)).toEqual([45]);
  });
});
