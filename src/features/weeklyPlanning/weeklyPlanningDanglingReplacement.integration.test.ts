import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { FOCUSED_REPLACEMENT_FACT_REPAIR_REQUEST_MAX_BYTES } from './semantic/weeklyPlanningFocusedReplacementFactRepairV5';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

// x9b (live round 5 C T2, typed shape, synthetic): 「やっぱり20ページにして、金曜日までに終わらせたい」 under an accepted 30-page plan.
// Both readings (initial and the single repair) carry only a workload `replace` correction whose replacementLocalId is declared
// nowhere, plus a task shell: the 20 pages are not declared and the Friday deadline is absent. Today: a disclosed recover.
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const T1 = '来週、レポートの文献を30ページ読む。1ページ3分くらい';
const T2 = 'やっぱり20ページにして、金曜日までに終わらせたい';
const empty = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [],
  corrections: [], decisions: [], conversationActs: [], ...o });
const nextWeek = { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
const pages = (localId: string, amount: number, sourceText: string): Json => ({ localId, quantityRole: 'target', amount, unitCode: 'page', unitLabel: 'ページ',
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText });
const task = (o: Json): Json => ({ localId: 'paper', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: 'レポートの文献',
  study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
  temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '文献を読む', ...o });
const deadline = (): Json => ({ localId: 'fri', targetLocalId: 'paper', kind: 'deadline', constraintLevel: 'hard', dateExpression: 'weekday:friday',
  namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText: '金曜日までに' });

const AUDIT = 'weekly_planning_dense_turn_completeness_audit_v5';
const FOCUSED = 'weekly_planning_focused_replacement_fact_repair_v5';
const OMISSION = '一部の内容を読み取れていない可能性があります';

interface Script {
  /** The focused recovery answer (default: the grounded {20, page}); null = decision fallback. */
  focused?: Json | null;
  audit?: Json;
  /** What the completeness retry reading (the generic call after an incomplete audit) returns. */
  retry?: 'deadline' | 'same';
  /** Replace the initial reading (default: the live shape: a dangling workload replace correction + a task shell). */
  initial?: (ids: { taskId: string; workload: string }) => Json;
}
const GROUNDED_20 = { replacements: [{ localId: 'pages20', decision: 'provided', quantityRole: 'target', amount: 20, unitCode: 'page', unitLabel: 'ページ', sourceText: '20ページ' }] };
const FALLBACK_20 = { replacements: [{ localId: 'pages20', decision: 'fallback', quantityRole: 'target', amount: 0, unitCode: 'page', unitLabel: 'ページ', sourceText: '' }] };

function install(script: Script, architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') {
  const seen: string[] = [];
  let genericAfterFocused = 0;
  let focusedSeen = false;
  const wire = (document: Json): string => JSON.stringify(architecture === 'legacy_v5'
    ? Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'conversationActs')) : document);
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    seen.push(call.kind === 'renderer' ? 'renderer' : String(call.schemaName).replace('weekly_planning_', '').replace('_v5', ''));
    if (call.kind === 'renderer') return scriptedRendererReply(call, '修正しました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    if (call.schemaName === FOCUSED) { focusedSeen = true; return JSON.stringify(script.focused === null ? FALLBACK_20 : (script.focused ?? GROUNDED_20)); }
    if (call.schemaName === AUDIT) return JSON.stringify(script.audit ?? { decision: 'complete', missingFacts: [] });
    const text = String(call.payload?.userText ?? '');
    const summary = (call.payload?.publicStateSummary ?? {}) as Json;
    const idOf = (rows: unknown) => { const first = ((rows as Json[]) ?? [])[0]; return first ? String(first.publicId) : ''; };
    const ids = { taskId: idOf(summary.tasks), workload: idOf(summary.workloads) };
    if (text === T1) return wire(empty({ planningIntent: 'create_plan', planningWindow: nextWeek, tasks: [task({
      workloads: [pages('amt', 30, '30ページ')],
      effortEstimates: [{ localId: 'rate', targetLocalId: 'amt', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: '1ページ3分くらい' }] })] }));
    if (focusedSeen && !text) {
      genericAfterFocused += 1;
      const base = [pages('pages20', 20, '20ページ')];
      return wire(empty({ corrections: [{ localId: 'c1', target: { kind: 'workload', publicId: ids.workload || lastWorkload, localId: null, mention: null }, operation: 'replace', replacementLocalId: 'pages20', sourceText: 'やっぱり20ページにして' }],
        tasks: [task({ existingPublicId: ids.taskId || lastTask, sourceText: T2, workloads: base, ...(script.retry === 'deadline' ? { temporalConstraints: [deadline()] } : {}) })] }));
    }
    lastWorkload = ids.workload; lastTask = ids.taskId;
    const initial = script.initial ?? ((i: { taskId: string; workload: string }) => empty({ corrections: [{ localId: 'c1', target: { kind: 'workload', publicId: i.workload, localId: null, mention: null }, operation: 'replace', replacementLocalId: 'pages20', sourceText: 'やっぱり20ページにして' }],
      tasks: [task({ existingPublicId: i.taskId, sourceText: T2 })] }));
    return wire(initial(ids));
  }, { completenessAudit: 'scripted' });
  return seen;
}
let lastWorkload = ''; let lastTask = '';
const open = (architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') => createScriptedConversation({ provider, architecture, weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
const activeOf = (conv: ReturnType<typeof open>) => {
  const g = conv.graph()!;
  const active = new Set(g.factLifecycles.filter(l => l.status === 'active').map(l => l.factId));
  return { workloads: g.workloads.filter(w => active.has(w.id)).map(w => w.amount), deadlines: g.temporalConstraints.filter(t => active.has(t.id) && t.kind === 'deadline').length };
};
async function run(script: Script, architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') {
  const seen = install(script, architecture);
  const conv = open(architecture);
  await conv.submit(T1);
  const before = seen.length;
  const turn = await conv.submit(T2);
  return { conv, turn, calls: seen.slice(before) };
}

describe('x9b: dangling workload replacement ids are recovered by a focused repair in place of the generic one (live round 5 C T2)', () => {
  it('RED (live): the focused recovery returns the grounded {20, page}; the audit is eligible and finds nothing → 20 pages applied, the possibly-uncovered deadline part is DISCLOSED', async () => {
    const { conv, turn, calls } = await run({});
    expect(calls).toEqual(['semantic_document', 'focused_replacement_fact_repair', 'dense_turn_completeness_audit', 'renderer']);
    expect(turn.result?.interactionOutcome?.kind).toBe('apply');
    expect(activeOf(conv).workloads).toEqual([20]);
    expect(activeOf(conv).deadlines).toBe(0);
    expect(turn.result?.communicationFacts?.possibleCompletenessOmission).toBe(true);
    expect(turn.result?.message).toContain(OMISSION);
  });

  it('audit incomplete and the retry reading recovers the deadline: 20 pages AND the Friday deadline, no disclosure', async () => {
    const { conv, turn, calls } = await run({ audit: { decision: 'incomplete', missingFacts: ['deadline Friday'] }, retry: 'deadline' });
    expect(calls).toEqual(['semantic_document', 'focused_replacement_fact_repair', 'dense_turn_completeness_audit', 'semantic_document', 'renderer']);
    expect(turn.result?.interactionOutcome?.kind).toBe('apply');
    expect(activeOf(conv)).toEqual({ workloads: [20], deadlines: 1 });
    expect(turn.result?.communicationFacts?.possibleCompletenessOmission).toBeUndefined();
    expect(turn.result?.message).not.toContain(OMISSION);
  });

  it('audit incomplete but the retry cannot take the omission in: 20 pages applied and the omission is disclosed (existing path)', async () => {
    const { conv, turn, calls } = await run({ audit: { decision: 'incomplete', missingFacts: ['deadline Friday'] }, retry: 'same' });
    expect(calls).toEqual(['semantic_document', 'focused_replacement_fact_repair', 'dense_turn_completeness_audit', 'semantic_document', 'renderer']);
    expect(activeOf(conv)).toEqual({ workloads: [20], deadlines: 0 });
    expect(turn.result?.communicationFacts?.possibleCompletenessOmission).toBe(true);
    expect(turn.result?.message).toContain(OMISSION);
  });

  it('a focused `fallback` decision is today\'s disclosed recover: 2 calls, nothing changes', async () => {
    const { conv, turn, calls } = await run({ focused: null });
    expect(calls).toEqual(['semantic_document', 'focused_replacement_fact_repair', 'renderer']);
    expect(turn.result?.interactionOutcome?.kind).toBe('recover');
    expect(turn.result?.message).toContain('今の仮予定は変えていません。');
    expect(activeOf(conv).workloads).toEqual([30]);
  });

  it('an invalid merge (an ungrounded quote) is the same disclosed recover', async () => {
    const { conv, turn } = await run({ focused: { replacements: [{ ...(GROUNDED_20.replacements[0]), sourceText: '二十ページ' }] } });
    expect(turn.result?.interactionOutcome?.kind).toBe('recover');
    expect(activeOf(conv).workloads).toEqual([30]);
  });

  it('other errors alongside the dangling id keep the generic repair (no focused call)', async () => {
    const { calls } = await run({ initial: i => empty({ corrections: [{ localId: 'c1', target: { kind: 'workload', publicId: i.workload, localId: null, mention: null }, operation: 'replace', replacementLocalId: 'pages20', sourceText: 'やっぱり20ページにして' }],
      tasks: [task({ existingPublicId: i.taskId, sourceText: T2, temporalConstraints: [{ ...deadline(), targetLocalId: 'nowhere' }] })] }) });
    expect(calls.slice(0, 2)).toEqual(['semantic_document', 'semantic_document']);
    expect(calls).not.toContain('focused_replacement_fact_repair');
  });

  it('legacy_v5 control: the generic repair is used, no focused call, same disclosed recover', async () => {
    const { turn, calls } = await run({}, 'legacy_v5');
    expect(calls).not.toContain('focused_replacement_fact_repair');
    expect(calls.filter(c => c === 'semantic_document').length).toBe(2);
    expect(turn.result?.state.shouldSavePlan).not.toBe(true);
  });

  it('effort-dangling replacement ids (the X5c r2 shape) keep the generic repair', async () => {
    const { calls } = await run({ initial: i => empty({ corrections: [{ localId: 'c2', target: { kind: 'effort_estimate', publicId: i.workload, localId: null, mention: null }, operation: 'replace', replacementLocalId: 'each2', sourceText: 'やっぱり20ページにして' }],
      tasks: [task({ existingPublicId: i.taskId, sourceText: T2 })] }) });
    expect(calls).not.toContain('focused_replacement_fact_repair');
  });

  it('the focused request has its own cap and stays under it (measured from the normalizer diagnostics)', async () => {
    const { turn } = await run({});
    const decision = turn.debugTrace.find(e => e.stage === 'semantic_normalizer_decision')?.data as { diagnostics?: { requestBytes?: number[] } } | undefined;
    const bytes = decision?.diagnostics?.requestBytes?.[1] ?? Infinity;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(FOCUSED_REPLACEMENT_FACT_REPAIR_REQUEST_MAX_BYTES);
  });
});
