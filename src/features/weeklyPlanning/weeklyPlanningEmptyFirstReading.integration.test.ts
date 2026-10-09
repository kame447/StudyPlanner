import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

// Live H r1/r2 (fd6a29fd): T3 「じゃあ水曜の夜にまとめて」 under an accepted plan, no pending question. An entirely empty first
// reading is never re-read (r1, placement dropped); a task-shell first reading is re-read and recovers (r2). Synthetic shapes.
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const T1 = '来週、レポートの文献を30ページ読む。1ページ3分くらい';
const T3 = 'じゃあ水曜の夜にまとめて';
const empty = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [],
  corrections: [], decisions: [], conversationActs: [], ...o });
const nextWeek = { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
const task = (o: Json): Json => ({ localId: 'paper', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: 'レポートの文献',
  study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
  temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '文献を読む', ...o });
const evening = { localId: 'eve', targetLocalId: 'paper', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: 'weekday:wednesday', namedTimePeriod: 'evening',
  startTime: null, endTime: null, precision: 'unspecified', sourceText: '水曜の夜に' };

type First = 'empty' | 'shell';
function install(first: First, rereadReturnsPlacement = true): { t3Calls: () => number } {
  let t3Calls = 0;
  let knownTaskId = '';
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    const [summaryTaskId] = ((((call.payload?.publicStateSummary ?? {}) as Json).tasks as Json[]) ?? []).map(x => String(x.publicId));
    if (summaryTaskId) knownTaskId = summaryTaskId;
    const taskId = knownTaskId;
    if (text === T1) return JSON.stringify(empty({ planningIntent: 'create_plan', planningWindow: nextWeek, tasks: [task({
      workloads: [{ localId: 'amt', quantityRole: 'target', amount: 30, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '30ページ' }],
      effortEstimates: [{ localId: 'rate', targetLocalId: 'amt', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: '1ページ3分くらい' }] })] }));
    // The re-read request carries the exact userText in its instruction message, not in the payload.
    if (text === T3 || (call.kind === 'semantic_generic' && t3Calls > 0 && call.messages.some(m => m.content.includes(T3)))) {
      t3Calls += 1;
      if (t3Calls === 1) return JSON.stringify(first === 'empty' ? empty() : empty({ tasks: [task({ existingPublicId: taskId, sourceText: T3 })] }));
      return JSON.stringify(rereadReturnsPlacement ? empty({ tasks: [task({ existingPublicId: taskId, sourceText: T3, temporalConstraints: [evening] })] }) : empty());
    }
    throw new Error(`unscripted: ${text}`);
  });
  return { t3Calls: () => t3Calls };
}
const open = () => createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
const preferred = (conv: ReturnType<typeof open>) => (conv.graph()!.temporalConstraints ?? []).filter(t => t.kind === 'preferred_window'
  && conv.graph()!.factLifecycles.find(l => l.factId === t.id)?.status === 'active').length;

describe('an empty first reading under an accepted plan, no pending question (live H r1/r2)', () => {
  it('control (live r2): a task-shell first reading is re-read and the Wednesday-night constraint is recovered', async () => {
    const calls = install('shell');
    const conv = open();
    await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(turn.calls.filter(c => c.kind === 'semantic_generic').length).toBeGreaterThan(1);
    void calls;
    expect(preferred(conv)).toBe(1);
    expect(turn.result?.interactionOutcome?.kind).not.toBe('recover');
  });

  it('RED (live r1): an entirely empty first reading is re-read too, so the placement is not dropped', async () => {
    const calls = install('empty');
    const conv = open();
    await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(turn.calls.filter(c => c.kind === 'semantic_generic').length).toBeGreaterThan(1);
    void calls;
    expect(preferred(conv)).toBe(1);
    expect(turn.result?.interactionOutcome?.kind).not.toBe('recover');
  });
});

const NOTHING_READ = 'この返事からは新しい条件を読み取っていません。条件があれば、あらためて教えてください。';
const once = (message: string | undefined) => (message ?? '').split(NOTHING_READ).length - 1;

/** Scripted T3 readings: the first reading and the re-read (documents built from the accepted task id). */
function installReadings(first: (taskId: string) => Json, reread: (taskId: string) => Json, architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') {
  let t3Calls = 0;
  let knownTaskId = '';
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, '候補はそのままです。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    const [summaryTaskId] = ((((call.payload?.publicStateSummary ?? {}) as Json).tasks as Json[]) ?? []).map(x => String(x.publicId));
    if (summaryTaskId) knownTaskId = summaryTaskId;
    const wire = (document: Json) => JSON.stringify(architecture === 'legacy_v5'
      ? Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'conversationActs')) : document);
    if (text === T1) return wire(empty({ planningIntent: 'create_plan', planningWindow: nextWeek, tasks: [task({
      workloads: [{ localId: 'amt', quantityRole: 'target', amount: 30, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '30ページ' }],
      effortEstimates: [{ localId: 'rate', targetLocalId: 'amt', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: '1ページ3分くらい' }] })] }));
    if (text === T3 || (call.kind === 'semantic_generic' && t3Calls > 0 && call.messages.some(m => m.content.includes(T3)))) {
      t3Calls += 1;
      return wire(t3Calls === 1 ? first(knownTaskId) : reread(knownTaskId));
    }
    throw new Error(`unscripted: ${text}`);
  });
}
const shell = (taskId: string, extra: Json = {}): Json => empty({ tasks: [task({ existingPublicId: taskId, sourceText: T3, ...extra })] });
const generic = (turn: { calls: ScriptedProviderCall[] }) => turn.calls.filter(c => c.kind === 'semantic_generic').length;

describe('x6: an entirely empty FINAL reading says so, once (nothingRead)', () => {
  it('live r1 with a re-read that is still empty (a bare acknowledgement): 2 calls, the preview is unchanged and the application says nothing was read, once', async () => {
    installReadings(() => empty(), () => empty());
    const conv = open();
    const first = await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(generic(turn)).toBe(2);
    expect(turn.result?.interactionOutcome?.kind).toBe('apply');
    expect(turn.result?.communicationFacts?.nothingRead).toBe(true);
    expect(once(turn.result?.message)).toBe(1);
    expect(turn.result?.message).toContain('候補はそのままです。');
    expect(preferred(conv)).toBe(0);
    expect(conv.getState().previewCandidates?.length).toBe(first.result?.draftCandidates.length);
  });

  it('a task shell with nothing in it, and an empty re-read, counts as empty too', async () => {
    installReadings(taskId => shell(taskId), taskId => shell(taskId));
    const conv = open();
    await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(generic(turn)).toBe(2);
    expect(once(turn.result?.message)).toBe(1);
  });

  it('live r1 where the re-read returns the placement: no sentence, the window is applied', async () => {
    installReadings(() => empty(), taskId => shell(taskId, { temporalConstraints: [evening] }));
    const conv = open();
    await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(generic(turn)).toBe(2);
    expect(preferred(conv)).toBe(1);
    expect(turn.result?.communicationFacts?.nothingRead).toBeUndefined();
    expect(once(turn.result?.message)).toBe(0);
  });

  it('a reading with a typed conversation act (consultation) is not empty: one call, no sentence', async () => {
    installReadings(taskId => empty({ conversationActs: [{ kind: 'consultation_request', targetPublicId: taskId }] }), () => empty());
    const conv = open();
    await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(generic(turn)).toBe(1);
    expect(turn.result?.communicationFacts?.nothingRead).toBeUndefined();
    expect(once(turn.result?.message)).toBe(0);
  });

  it('a reading that carries the placement on the first read: one call, no sentence', async () => {
    installReadings(taskId => shell(taskId, { temporalConstraints: [evening] }), () => empty());
    const conv = open();
    await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(generic(turn)).toBe(1);
    expect(preferred(conv)).toBe(1);
    expect(once(turn.result?.message)).toBe(0);
  });

  it('legacy_v5 control: an empty reading under a plan is not re-read and carries no nothingRead fact', async () => {
    installReadings(() => empty(), () => empty(), 'legacy_v5');
    const conv = createScriptedConversation({ provider, architecture: 'legacy_v5', weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
    await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(generic(turn)).toBe(1);
    expect(turn.result?.communicationFacts?.nothingRead).toBeUndefined();
    expect(once(turn.result?.message)).toBe(0);
  });

  it('B-T4 shape (a shell carrying a description that binding discards, then an empty re-read): the unusable-message recover stands and nothingRead stays off', async () => {
    const described = (taskId: string): Json => shell(taskId, { study: { purpose: 'self_study', activityKind: 'reading', contextLabel: '宿題', components: [] } });
    installReadings(described, () => empty());
    const conv = open();
    const first = await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(generic(turn)).toBe(2);
    expect(turn.result?.interactionOutcome?.kind).toBe('recover');
    expect(turn.result?.communicationFacts?.nothingRead).toBeUndefined();
    expect(once(turn.result?.message)).toBe(0);
    expect(turn.result?.message).toContain('今の仮予定は変えていません。');
    expect(conv.getState().previewCandidates?.length).toBe(first.result?.draftCandidates.length);
  });

  it('under a pending question: an empty final reading says so once beside the re-presented question', async () => {
    let t3Calls = 0;
    provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, '教えてください。');
      if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
      if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
      if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
      const text = String(call.payload?.userText ?? '');
      if (text === '来週、レポートの文献を30ページ読む') return JSON.stringify(empty({ planningIntent: 'create_plan', planningWindow: nextWeek, tasks: [task({
        workloads: [{ localId: 'amt', quantityRole: 'target', amount: 30, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '30ページ' }] })] }));
      t3Calls += 1;
      return JSON.stringify(empty());
    });
    const conv = open();
    const first = await conv.submit('来週、レポートの文献を30ページ読む');
    expect(first.result?.state.lastQuestionContext?.targetSlot).toBeTruthy();
    const turn = await conv.submit('うん');
    expect(t3Calls).toBeGreaterThan(0);
    expect(turn.result?.communicationFacts?.nothingRead).toBe(true);
    expect(once(turn.result?.message)).toBe(1);
  });
});

