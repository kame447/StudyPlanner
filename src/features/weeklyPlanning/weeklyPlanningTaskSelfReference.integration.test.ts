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
const T1B = T1 + '。英語の本も10ページ読む。1ページ3分';
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

interface Ids { taskId: string; workloadId: string; otherTaskId: string }
function install(readings: { first: (ids: Ids) => Json; reread: (ids: Ids) => Json; repair: (ids: Ids) => Json }, twoTasks = false) {
  let t3Calls = 0;
  const ids: Ids = { taskId: '', workloadId: '', otherTaskId: '' };
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    const summary = (call.payload?.publicStateSummary ?? {}) as Json;
    const summaryTasks = ((summary.tasks as Json[]) ?? []);
    const [taskId] = summaryTasks.map(x => String(x.publicId));
    const otherTaskId = String(summaryTasks.find(x => x.title === '英語の本')?.publicId ?? '');
    const [workloadId] = ((summary.workloads as Json[]) ?? []).map(x => String(x.publicId));
    if (taskId) { ids.taskId = summaryTasks.find(x => x.title === 'レポートの文献') ? String(summaryTasks.find(x => x.title === 'レポートの文献')!.publicId) : taskId; ids.workloadId = workloadId; ids.otherTaskId = otherTaskId; }
    if (text === T1 || text === T1B) return JSON.stringify(empty({ planningIntent: 'create_plan', planningWindow: nextWeek, tasks: [task({
      workloads: [{ localId: 'amt', quantityRole: 'target', amount: 30, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '30ページ' }],
      effortEstimates: [{ localId: 'rate', targetLocalId: 'amt', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: '1ページ3分くらい' }] }),
      ...(twoTasks ? [task({ localId: 'task_B', title: '英語の本', sourceText: '英語の本も10ページ読む', workloads: [{ localId: 'amtB', quantityRole: 'target', amount: 10, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '10ページ' }],
        effortEstimates: [{ localId: 'rateB', targetLocalId: 'amtB', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: '1ページ3分' }] })] : [])] }));
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

  it('end to end (live trace shape): 2 semantic calls, the Wednesday-evening window and the 75-minute session are applied, and the reply never says it could not be used', async () => {
    install({ first: shell, reread: liveReread, repair: liveRepair });
    const conv = open();
    await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(generic(turn)).toBe(2);
    expect(turn.result?.message).not.toContain('使えませんでした');
    expect(turn.result?.interactionOutcome?.kind).toBe('apply');
    const graph = conv.graph()!;
    const active = new Set(graph.factLifecycles.filter(l => l.status === 'active').map(l => l.factId));
    expect(graph.effortEstimates.filter(e => active.has(e.id) && e.kind === 'session_duration').map(e => e.minutes)).toEqual([75]);
    const algorithmic = turn.debugTrace.flatMap(e => JSON.stringify((e as { data?: unknown }).data ?? null).match(/task-self-reference-projected[^"\\]*/g) ?? []);
    expect(algorithmic.length).toBeGreaterThan(0);
  });

  it('first-reading variant: the initial reading itself uses its own task\'s public id: applied directly, 1 call, no re-read, no repair', async () => {
    install({ first: ids => empty({ tasks: [task({ existingPublicId: ids.taskId, sourceText: T3, temporalConstraints: [evening(ids.taskId)] })] }), reread: () => empty(), repair: () => empty() });
    const conv = open();
    await conv.submit(T1);
    const turn = await conv.submit(T3);
    expect(generic(turn)).toBe(1);
    expect(activeWindows(conv)).toHaveLength(1);
    expect(turn.result?.interactionOutcome?.kind).toBe('apply');
    expect(JSON.stringify(turn.debugTrace)).not.toContain('"attempt":"repair"');
  });

  it('repair variant: a constraint targeting ANOTHER task\'s public id is not hidden by the projection: it goes to the single repair (2 calls, repairAttempted) and the repaired reading applies', async () => {
    install({
      first: ids => empty({ tasks: [task({ existingPublicId: ids.taskId, sourceText: T3, temporalConstraints: [evening(ids.otherTaskId)] })] }),
      // the 2nd T3 call is the repair here (the first reading carries a delta, so there is no re-read)
      reread: ids => empty({ tasks: [task({ existingPublicId: ids.taskId, sourceText: T3, temporalConstraints: [evening('task_A')] })] }), repair: () => empty(),
    }, true);
    const conv = open();
    await conv.submit(T1B);
    const turn = await conv.submit(T3);
    const validations = turn.debugTrace.filter(e => e.stage === 'semantic_validation_result').map(e => JSON.stringify(e.data));
    expect(validations[0]).toContain('temporalConstraints[0].targetLocalId');
    expect(validations.some(v => v.includes('"attempt":"repair"') && v.includes('"accepted":true'))).toBe(true);
    expect(generic(turn)).toBe(2);
    const normalizerDecision = JSON.stringify(turn.debugTrace.filter(e => e.stage === 'semantic_normalizer_decision').map(e => e.data));
    expect(normalizerDecision).toContain('"repairAttempted":true');
    expect(normalizerDecision).not.toContain('task-self-reference-projected');
    expect(activeWindows(conv)).toHaveLength(1);
  });
});

