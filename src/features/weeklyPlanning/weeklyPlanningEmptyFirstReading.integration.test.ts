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
