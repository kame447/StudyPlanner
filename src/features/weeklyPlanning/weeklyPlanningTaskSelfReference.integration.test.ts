import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

// Live H r1 on 80af22a3 (typed shape, synthetic ids): T3 「じゃあ水曜の夜にまとめて」 after a plan, no pending question.
// First reading: a task shell. Re-read: right content, but the constraint's targetLocalId is its OWN containing task's public id
// (the effort's is the public workload id, which an existing bridge already handles). The only validation error is the constraint;
// the repair then breaks the effort (an undeclared local workload id) and the turn is rejected: the placement is lost.
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const T1 = '来週、レポートの文献を30ページ読む。1ページ3分くらい';
const T3 = 'じゃあ水曜の夜にまとめて';
const empty = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [],
  corrections: [], decisions: [], conversationActs: [], ...o });
const nextWeek = { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
const task = (o: Json): Json => ({ localId: 'task_A', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: 'レポートの文献',
  study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
  temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '文献を読む', ...o });
const evening = (targetLocalId: string): Json => ({ localId: 'eve', targetLocalId, kind: 'preferred_window', constraintLevel: 'soft',
  dateExpression: 'weekday:wednesday', namedTimePeriod: 'evening', startTime: null, endTime: null, precision: 'unspecified', sourceText: '水曜の夜に' });
const session = (targetLocalId: string): Json => ({ localId: 'sess', targetLocalId, kind: 'session_duration', minutes: 75, unitCode: null,
  precision: 'approximate', sourceText: 'まとめて' });

interface Ids { taskId: string; workloadId: string }
function install(readings: { first: (ids: Ids) => Json; reread: (ids: Ids) => Json; repair: (ids: Ids) => Json }) {
  let t3Calls = 0;
  const ids: Ids = { taskId: '', workloadId: '' };
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    const summary = (call.payload?.publicStateSummary ?? {}) as Json;
    const [taskId] = ((summary.tasks as Json[]) ?? []).map(x => String(x.publicId));
    const [workloadId] = ((summary.workloads as Json[]) ?? []).map(x => String(x.publicId));
    if (taskId) { ids.taskId = taskId; ids.workloadId = workloadId; }
    if (text === T1) return JSON.stringify(empty({ planningIntent: 'create_plan', planningWindow: nextWeek, tasks: [task({
      workloads: [{ localId: 'amt', quantityRole: 'target', amount: 30, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '30ページ' }],
      effortEstimates: [{ localId: 'rate', targetLocalId: 'amt', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: '1ページ3分くらい' }] })] }));
    if (text === T3 || (call.kind === 'semantic_generic' && t3Calls > 0 && call.messages.some(m => m.content.includes(T3)))) {
      t3Calls += 1;
      const pick = t3Calls === 1 ? readings.first : t3Calls === 2 ? readings.reread : readings.repair;
      return JSON.stringify(pick(ids));
    }
    throw new Error(`unscripted: ${text}`);
  });
}
const open = () => createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
const shell = (ids: Ids) => empty({ tasks: [task({ existingPublicId: ids.taskId, sourceText: T3 })] });
// The live re-read: constraint targets the containing task's PUBLIC id; the effort targets the PUBLIC workload id (bridged today).
const liveReread = (ids: Ids) => empty({ tasks: [task({ existingPublicId: ids.taskId, sourceText: T3,
  effortEstimates: [session(ids.workloadId)], temporalConstraints: [evening(ids.taskId)] })] });
// The live repair: the constraint is fixed, but the effort now targets an undeclared local workload id.
const liveRepair = (ids: Ids) => empty({ tasks: [task({ existingPublicId: ids.taskId, sourceText: T3,
  effortEstimates: [session('workload_1')], temporalConstraints: [evening('task_A')] })] });
const generic = (turn: { calls: ScriptedProviderCall[] }) => turn.calls.filter(c => c.kind === 'semantic_generic').length;
const activeWindows = (conv: ReturnType<typeof open>) => conv.graph()!.temporalConstraints.filter(t => t.kind === 'preferred_window'
  && conv.graph()!.factLifecycles.find(l => l.factId === t.id)?.status === 'active');

describe('x7: a nested fact targeting its own containing task by public id (live H r1 on 80af22a3)', () => {
  it('RED (live): shell, then the re-read with a self-referencing constraint, then the broken repair → the Wednesday-evening window is applied with no repair call', async () => {
    install({ first: shell, reread: liveReread, repair: liveRepair });
    const conv = open();
    await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(generic(turn)).toBe(2);
    expect(turn.result?.interactionOutcome?.kind).not.toBe('recover');
    expect(activeWindows(conv)).toHaveLength(1);
    expect(turn.result?.draftCandidates.length).toBeGreaterThan(0);
  });
});
