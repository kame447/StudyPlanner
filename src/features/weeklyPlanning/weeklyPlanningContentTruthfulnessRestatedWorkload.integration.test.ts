import { afterEach, describe, expect, it } from 'vitest';
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { restatesAcceptedWorkload } from './semantic/weeklyPlanningExistingEntityBindingV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedConversation, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

// Live H-T3 (round 4): the accepted task has workload {25, page, target} and 3 min/page. The next turn
// restates that workload on the bound task without existingPublicId, with a session length and a
// Wednesday-evening window. The identical restatement must keep the accepted fact and its rate.
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const empty = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [],
  corrections: [], decisions: [], conversationActs: [], ...o });
const nextWeek = { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
const pages = (localId: string, amount: number, sourceText: string): Json => ({ localId, quantityRole: 'target', amount, unitCode: 'page',
  unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText });
const task = (o: Json): Json => ({ localId: 'paper', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: 'レポートの文献',
  study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
  temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '文献を読む', ...o });
const T = { T1: '来週、レポートの文献を30ページ読む。1ページ3分くらい', T2: 'あ、やっぱり25ページで、1ページ3分のまま', T3: 'じゃあ水曜の夜にまとめて' };

function install(t3: (taskId: string) => Json): void {
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    const [taskId] = (((call.payload?.publicStateSummary ?? {}) as Json).tasks as Json[] ?? []).map(x => String(x.publicId));
    if (text === T.T1) return JSON.stringify(empty({ planningIntent: 'create_plan', planningWindow: nextWeek, tasks: [task({
      workloads: [pages('amt', 30, '30ページ')], effortEstimates: [{ localId: 'rate', targetLocalId: 'amt', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: '1ページ3分くらい' }] })] }));
    const oldWorkload = String((((call.payload?.publicStateSummary ?? {}) as Json).workloads as Json[] ?? [])[0]?.publicId);
    if (text === T.T2) return JSON.stringify(empty({
      corrections: [{ localId: 'fix', target: { kind: 'workload', publicId: oldWorkload, localId: null, mention: null }, operation: 'replace', replacementLocalId: 'amt2', sourceText: 'やっぱり25ページで' }],
      tasks: [task({ existingPublicId: taskId, sourceText: 'やっぱり25ページで',
      workloads: [pages('amt2', 25, '25ページ')], effortEstimates: [{ localId: 'rate2', targetLocalId: 'amt2', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: '1ページ3分のまま' }] })],
      uncertainties: [{ localId: 'u1', targetLocalId: 'paper', field: 'one_day_completion_feasibility', reason: '1日でまとめて読めるか', sourceText: 'あとこれって1日でまとめて読んでも平気？', blocksPlanning: false }],
      conversationActs: [{ kind: 'consultation_request', targetPublicId: taskId }] }));
    return JSON.stringify(t3(taskId));
  });
}
const open = (): ScriptedConversation => createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
const evening = { localId: 'eve', targetLocalId: 'paper', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: 'weekday:wednesday', namedTimePeriod: 'evening',
  startTime: null, endTime: null, precision: 'unspecified', sourceText: '水曜の夜に' };
const liveT3 = (taskId: string): Json => empty({ tasks: [task({ existingPublicId: taskId, sourceText: '水曜の夜にまとめて',
  workloads: [pages('amt3', 25, '25ページ')],
  effortEstimates: [{ localId: 'sess', targetLocalId: 'amt3', kind: 'session_duration', minutes: 75, unitCode: null, precision: 'approximate', sourceText: 'まとめて' }],
  temporalConstraints: [evening] })] });

const material = (workloads: Json[], existingPublicId: string | null = null): Json => ({ localId: 'mat', existingPublicId, role: 'material', label: '文献',
  parentLocalId: null, workloads, durableContextSignals: [], sourceText: '文献' });

function installComponent(t3: (taskId: string, componentId: string) => Json): void {
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    const summary = (call.payload?.publicStateSummary ?? {}) as Json;
    const [taskId] = ((summary.tasks as Json[]) ?? []).map(x => String(x.publicId));
    const [componentId] = ((summary.components as Json[]) ?? []).map(x => String(x.publicId));
    const oldWorkload = String(((summary.workloads as Json[]) ?? [])[0]?.publicId);
    const rate = (id: string, target: string, st: string): Json => ({ localId: id, targetLocalId: target, kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: st });
    const withComp = (extra: Json, comp: Json): Json => task({ ...extra, study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [comp] } });
    if (text === T.T1) return JSON.stringify(empty({ planningIntent: 'create_plan', planningWindow: nextWeek, tasks: [withComp({ effortEstimates: [rate('rate', 'amt', '1ページ3分くらい')] }, material([pages('amt', 30, '30ページ')]))] }));
    if (text === T.T2) return JSON.stringify(empty({
      corrections: [{ localId: 'fix', target: { kind: 'workload', publicId: oldWorkload, localId: null, mention: null }, operation: 'replace', replacementLocalId: 'amt2', sourceText: 'やっぱり25ページで' }],
      tasks: [withComp({ existingPublicId: taskId, sourceText: 'やっぱり25ページで', effortEstimates: [rate('rate2', 'amt2', '1ページ3分のまま')] }, material([pages('amt2', 25, '25ページ')], componentId))] }));
    return JSON.stringify(t3(taskId, componentId));
  });
}

describe('restatesAcceptedWorkload: exact core, null-tolerant nullable fields', () => {
  const fact = { quantityRole: 'target', amount: 25, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null,
    perOccurrence: false, periodExpression: null } as never;
  const semantic = (o: Json = {}) => ({ localId: 'x', quantityRole: 'target', amount: 25, unitCode: 'page', unitLabel: 'p.', rangeStart: null,
    rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '', ...o }) as never;
  it('binds an identical restatement whatever its unitLabel', () => {
    expect(restatesAcceptedWorkload(semantic(), fact)).toBe(true);
  });
  it.each([
    ['per-day restating a total', { perOccurrence: true }, {}],
    ['total restating a per-day', {}, { perOccurrence: true }],
    ['different amount', { amount: 30 }, {}],
    ['different unit', { unitCode: 'problem' }, {}],
    ['different role', { quantityRole: 'remaining' }, {}],
    ['a different range', { rangeStart: '30', rangeEnd: '40' }, { rangeStart: '1', rangeEnd: '25' }],
    ['a stated period vs none accepted', { periodExpression: 'daily' }, {}],
  ] as const)('does not bind: %s', (_name, restated, accepted) => {
    expect(restatesAcceptedWorkload(semantic(restated), { ...(fact as object), ...accepted } as never)).toBe(false);
  });
  it('binds a null range / period restating an accepted one', () => {
    expect(restatesAcceptedWorkload(semantic(), { ...(fact as object), rangeStart: '1', rangeEnd: '25', periodExpression: 'weekly' } as never)).toBe(true);
  });
});

describe('H-T3: an identical restated workload keeps the accepted fact and its rate', () => {
  it('live shape: bound task, identical workload without existingPublicId → rate kept, preview kept', async () => {
    install(liveT3);
    const conversation = open();
    const first = await conversation.submit(T.T1);
    expect(first.result?.draftCandidates.length).toBeGreaterThan(0);
    const second = await conversation.submit(T.T2);
    expect(second.result?.draftCandidates.length).toBeGreaterThan(0);
    const before = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    const third = await conversation.submit(T.T3);
    const after = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    expect(after.workloads.filter(w => w.amount === 25)).toHaveLength(1);
    expect(after.workloads.map(w => w.id)).toEqual(before.workloads.map(w => w.id));
    expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).not.toBe('stable_v5:missing_effort_estimate');
    expect(third.result?.draftCandidates.length).toBeGreaterThan(0);
  });

  it('component-held accepted workload restated at task level without ids', async () => {
    installComponent((taskId) => liveT3(taskId));
    const conversation = open();
    await conversation.submit(T.T1);
    const second = await conversation.submit(T.T2);
    expect(second.result?.draftCandidates.length).toBeGreaterThan(0);
    const before = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    const third = await conversation.submit(T.T3);
    const after = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    expect(after.workloads.map(w => w.id)).toEqual(before.workloads.map(w => w.id));
    expect(after.effortEstimates.filter(e => e.kind === 'duration_per_unit' && e.targetFactId === after.workloads[0].id)).toHaveLength(1);
    expect(after.effortEstimates.some(e => e.kind === 'session_duration' && e.minutes === 75)).toBe(true);
    expect(third.result?.interactionOutcome?.kind).not.toBe('recover');
    expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).not.toBe('stable_v5:missing_effort_estimate');
    expect(third.result?.draftCandidates.length).toBeGreaterThan(0);
  });
});
