import { afterEach, describe, expect, it } from 'vitest';
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { WEEKLY_PLANNING_VERIFIED_DIALOGUE_TECHNICAL_STOP_TEXT } from './dialogue/weeklyPlanningTechnicalStop';
import { acceptingReplyVerifierReply } from './testUtils/weeklyPlanningExamOverloadFixture';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply,
  type ScriptedConversation, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

/*
 * Issue #488 P3 slice 1 (owner's comment #10, live round 5 F): a reading binds to the question the user was SHOWN only through a
 * contribution whose own typed role matches. A plan target (or a bare total) answering a progress question is demoted to a
 * declared, role-unresolved fact, so the typed role confirmation asks; nothing is promoted or lost. The held purpose only
 * demotes: it is never sent to the semantic model and never fills in a missing role or scope.
 */
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let rendererOverride: ((call: ScriptedProviderCall, waiting: Json | undefined) => string) | null = null;
let verifierOverride: ((call: ScriptedProviderCall) => string) | null = null;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); rendererOverride = null; verifierOverride = null; });
const waitingEntry = (call: ScriptedProviderCall): Json | undefined =>
  ((((call.payload?.applicationDecision as Json | undefined)?.communication as Json | undefined)?.mustConvey ?? []) as Json[]).find(entry => entry.code === 'declared_amount_waiting');
/** A faithful held-turn reply: the user's own quote, the amount is not used yet, and it waits for the to-do-or-done choice. */
const faithfulWaiting = (waiting: Json) => `「${waiting.quote}」の${waiting.amount}分は、まだ計画には使っていません。これからやる分か、もう終わった分か教えてください。`;

const doc = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
  availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...o });
const week = { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
const task = (id: string | null, sourceText: string, extra: Json = {}): Json => ({ localId: 'thesis', existingPublicId: id, decompositionStatus: 'atomic', category: 'study', title: '卒研',
  study: { purpose: 'self_study', activityKind: 'other', contextLabel: null, components: [] }, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [],
  durableContextSignals: [], sourceText, ...extra });
const night = (text: string): Json => ({ localId: 'night', targetLocalId: 'thesis', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'unspecified', sourceText: text });
const total = (minutes: number, text: string): Json => ({ localId: 'e-total', targetLocalId: 'thesis', kind: 'total_duration', minutes, unitCode: null, precision: 'approximate', sourceText: text });
const amount = (id: string, role: string, n: number, unit: string, label: string, text: string): Json => ({ localId: id, quantityRole: role, amount: n, unitCode: unit, unitLabel: label,
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: text });

const T1_UNQUANTIFIED = '来週は卒研を進めたい。できれば夜';
const T1_BOUNDED = '来週は卒研を進めたい。全部で90ページある';
const BUDGET = '合計2時間くらい';
const DONE_PLUS_BUDGET = '30ページ終わって、合計2時間くらい';
const DONE_HOURS = '2時間は終わってます';
const NEW_TASK_BUDGET = '卒研は合計2時間くらい';
const CONFIRM = 'これからやる分です';
const ALREADY_DONE = 'もう終わった分です';

function install(script: (text: string, taskId: string | undefined) => Json) {
  let lastText = '';
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'reply_verifier') return (verifierOverride ?? acceptingReplyVerifierReply)(call);
    if (call.kind === 'renderer') {
      const waiting = waitingEntry(call);
      return scriptedRendererReply(call, rendererOverride ? rendererOverride(call, waiting) : waiting ? faithfulWaiting(waiting) : 'わかりました。');
    }
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') {
      const said = String(call.payload?.currentUserText ?? '');
      const confirmed = said === CONFIRM || said === ALREADY_DONE;
      return JSON.stringify({ decision: confirmed ? 'quantity_role_answer' : 'fallback', effortTarget: null, effortMeasurement: null, minutes: null,
        precision: null, quantityRole: confirmed ? (said === CONFIRM ? 'target' : 'completed') : null });
    }
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') {
      return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    }
    const text = String(call.payload?.userText ?? lastText);
    lastText = text;
    const taskId = (((call.payload?.publicStateSummary as Json | undefined)?.tasks ?? []) as Json[])[0]?.publicId as string | undefined;
    return JSON.stringify(script(text, taskId));
  });
}
const open = (architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') => createScriptedConversation({ provider, architecture, weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
const slot = (c: ScriptedConversation) => c.getState().intakeState?.lastQuestionContext?.targetSlot;
const active = (c: ScriptedConversation) => {
  const graph = c.graph()!;
  const ids = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
  return { workloads: graph.workloads.filter(w => ids.has(w.id)), efforts: graph.effortEstimates.filter(e => ids.has(e.id)) };
};
const minutes = (c: ScriptedConversation) => (c.getState().previewCandidates ?? []).reduce((sum, entry) => sum + entry.durationMinutes, 0);

describe('live F shape (round 6): missing_schedulable_work on an unbounded, non-material task asks current progress', () => {
  const script = (extra: (text: string) => Json) => (text: string, id: string | undefined): Json => text === T1_UNQUANTIFIED
    ? doc({ planningIntent: 'create_plan', planningWindow: week, tasks: [task(null, '卒研を進めたい', { temporalConstraints: [night('できれば夜')] })] })
    : doc({ tasks: [task(id!, text, extra(text))] });

  it('the original F script, pre-fix failure: 「合計2時間くらい」 answering the progress question was silently promoted to a 2-hour plan', async () => {
    install(script(text => text === BUDGET ? { effortEstimates: [total(120, BUDGET)] } : {}));
    const conversation = open();
    await conversation.submit(T1_UNQUANTIFIED);
    expect(slot(conversation)).toBe('stable_v5:missing_schedulable_work');
    const second = await conversation.submit(BUDGET);
    // Pre-fix: minutes === 120 (the projected target budget). Now: not promoted.
    expect(minutes(conversation)).toBe(0);
    expect(second.result?.draftCandidates).toEqual([]);
    const { workloads, efforts } = active(conversation);
    expect(workloads.filter(w => w.quantityRole === 'target')).toEqual([]);
    expect(workloads).toEqual([expect.objectContaining({ quantityRole: 'declared', amount: 120, unitCode: 'minute' })]);
    expect(efforts.filter(e => e.kind === 'total_duration')).toEqual([]);
    expect(JSON.stringify(second.debugTrace)).toContain('answer-purpose-mismatch-declared:1');
  });
  it('(iii) the semantic request carries no held or declared purpose (the reading comes from the question as shown)', async () => {
    install(script(text => text === BUDGET ? { effortEstimates: [total(120, BUDGET)] } : {}));
    const conversation = open();
    await conversation.submit(T1_UNQUANTIFIED);
    const second = await conversation.submit(BUDGET);
    for (const call of second.calls.filter(entry => entry.kind.startsWith('semantic'))) {
      expect(JSON.stringify(call.messages)).not.toMatch(/current_progress|heldPurpose|askedPurpose/);
      const pending = ((call.payload?.publicStateSummary as Json | undefined)?.pendingQuestion ?? {}) as Json;
      expect(Object.keys(pending)).not.toContain('purpose');
    }
  });
  it('(a) after the demotion the NEXT question is the role confirmation, and 「これからやる分」 then applies the 120 in exactly two turns', async () => {
    install(script(text => text === BUDGET ? { effortEstimates: [total(120, BUDGET)] } : {}));
    const conversation = open();
    await conversation.submit(T1_UNQUANTIFIED);
    await conversation.submit(BUDGET);
    expect(slot(conversation)).toBe('stable_v5:quantity_role_unresolved');
    const confirmed = await conversation.submit(CONFIRM);
    expect(confirmed.result?.failure).toBeUndefined();
    expect(minutes(conversation)).toBe(120);
    expect(active(conversation).workloads).toEqual([expect.objectContaining({ quantityRole: 'target', amount: 120, unitCode: 'minute' })]);
  });
  it('(a2) 「もう終わった量」 as the role answer gives no new plan', async () => {
    install(script(text => text === BUDGET ? { effortEstimates: [total(120, BUDGET)] } : {}));
    const conversation = open();
    await conversation.submit(T1_UNQUANTIFIED);
    await conversation.submit(BUDGET);
    const done = await conversation.submit(ALREADY_DONE);
    expect(done.result?.failure).toBeUndefined();
    expect(minutes(conversation)).toBe(0);
  });
  it('(d) repeated budgets terminate: progress question, budget, budget again -> the same progress question is not presented a third time', async () => {
    install(script(text => text === BUDGET ? { effortEstimates: [total(120, BUDGET)] } : {}));
    const conversation = open();
    await conversation.submit(T1_UNQUANTIFIED);
    const progressSlots = [slot(conversation)];
    await conversation.submit(BUDGET);
    progressSlots.push(slot(conversation));
    await conversation.submit(BUDGET);
    progressSlots.push(slot(conversation));
    expect(progressSlots.filter(entry => entry === 'stable_v5:missing_schedulable_work')).toHaveLength(1);
    expect(minutes(conversation)).toBe(0);
  });
  it('(b) a reading meaning "2 hours already done" binds as completed and creates no plan', async () => {
    install(script(text => text === DONE_HOURS ? { workloads: [amount('done', 'completed', 2, 'hour', '時間', DONE_HOURS)] } : {}));
    const conversation = open();
    await conversation.submit(T1_UNQUANTIFIED);
    await conversation.submit(DONE_HOURS);
    expect(minutes(conversation)).toBe(0);
    expect(active(conversation).workloads.map(w => w.quantityRole)).toEqual(['completed']);
  });
  it('legacy_v5 is untouched: the budget is still promoted (byte-identical behaviour)', async () => {
    provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, '');
      const text = String(call.payload?.userText ?? '');
      const taskId = (((call.payload?.publicStateSummary as Json | undefined)?.tasks ?? []) as Json[])[0]?.publicId as string | undefined;
      const d = script(t => t === BUDGET ? { effortEstimates: [total(120, BUDGET)] } : {})(text, taskId);
      delete d.conversationActs;
      return JSON.stringify(d);
    });
    const conversation = open('legacy_v5');
    await conversation.submit(T1_UNQUANTIFIED);
    await conversation.submit(BUDGET);
    expect(minutes(conversation)).toBe(120);
  });
});

describe('a bounded progress question (「全90ページのうち今どこまで」), per-contribution match', () => {
  const script = (extra: (text: string) => Json) => (text: string, id: string | undefined): Json => text === T1_BOUNDED
    ? doc({ planningIntent: 'create_plan', planningWindow: week, tasks: [task(null, '卒研を進めたい', { decompositionStatus: 'atomic',
        workloads: [amount('scope', 'scope_total', 90, 'page', 'ページ', '全部で90ページ')] })] })
    : text === NEW_TASK_BUDGET
      ? doc({ tasks: [task(null, text, { decompositionStatus: 'atomic', effortEstimates: [total(120, text)] })] })
      : doc({ tasks: [task(id!, text, extra(text))] });

  it('precondition: the shown question is the bounded progress question', async () => {
    install(script(() => ({})));
    const conversation = open();
    await conversation.submit(T1_BOUNDED);
    expect(slot(conversation)).toBe('stable_v5:missing_schedulable_work');
  });
  it('a bare total answering it is not promoted: it becomes a declared fact and the role confirmation asks', async () => {
    install(script(text => text === BUDGET ? { effortEstimates: [total(120, BUDGET)] } : {}));
    const conversation = open();
    await conversation.submit(T1_BOUNDED);
    await conversation.submit(BUDGET);
    expect(minutes(conversation)).toBe(0);
    expect(slot(conversation)).toBe('stable_v5:quantity_role_unresolved');
    expect(active(conversation).workloads.filter(w => w.quantityRole === 'target')).toEqual([]);
  });
  it('per contribution: 「30ページ終わって、合計2時間くらい」 binds the 30 pages and sends the 120 to the role confirmation', async () => {
    install(script(text => text === DONE_PLUS_BUDGET
      ? { workloads: [amount('done', 'completed', 30, 'page', 'ページ', '30ページ終わって')], effortEstimates: [total(120, '合計2時間くらい')] } : {}));
    const conversation = open();
    await conversation.submit(T1_BOUNDED);
    await conversation.submit(DONE_PLUS_BUDGET);
    const { workloads } = active(conversation);
    expect(workloads.find(w => w.quantityRole === 'completed')).toMatchObject({ amount: 30, unitCode: 'page' });
    expect(workloads.find(w => w.quantityRole === 'declared')).toMatchObject({ amount: 120, unitCode: 'minute' });
    expect(workloads.some(w => w.quantityRole === 'target')).toBe(false);
    expect(minutes(conversation)).toBe(0);
    expect(slot(conversation)).toBe('stable_v5:quantity_role_unresolved');
  });
  it('entity bypass: a new task carrying the owner\'s exact title with a total is not a silent 2-hour plan', async () => {
    install(script(() => ({})));
    const conversation = open();
    await conversation.submit(T1_BOUNDED);
    const second = await conversation.submit(NEW_TASK_BUDGET);
    expect(minutes(conversation)).toBe(0);
    expect(second.result?.draftCandidates).toEqual([]);
    expect(active(conversation).workloads.filter(w => w.quantityRole === 'target')).toEqual([]);
  });
  it('a completed answer binds and no plan is made', async () => {
    install(script(text => text === DONE_HOURS ? { workloads: [amount('done', 'completed', 30, 'page', 'ページ', DONE_HOURS)] } : {}));
    const conversation = open();
    await conversation.submit(T1_BOUNDED);
    await conversation.submit(DONE_HOURS);
    const roles = active(conversation).workloads.map(w => w.quantityRole);
    expect(roles).toEqual(expect.arrayContaining(['completed', 'scope_total']));
    expect(roles).not.toContain('declared');
    expect(minutes(conversation)).toBe(0);
  });
});

describe('questions that hold no purpose in S1 bind plan answers without demotion', () => {
  it('(b) live X3 shape: a pending work_breakdown clarification answered 「3章ぶん、1章40分」 binds as the target and previews', async () => {
    const T1 = '来週、化学の参考書を進めたいんだけど、どのくらい時間がかかるか見当がつかない';
    const T3 = 'じゃあ3章ぶん、1章40分で見ておく';
    install((text, id) => {
      if (text === T1) {
        return doc({ planningIntent: 'create_plan', planningWindow: week,
          tasks: [{ ...task(null, '化学の参考書を進めたい'), title: '化学の参考書', decompositionStatus: 'needs_breakdown' }],
          uncertainties: [{ localId: 'u', targetLocalId: 'thesis', field: 'work_breakdown', reason: 'r', sourceText: '化学の参考書を進めたい' }] });
      }
      return doc({ tasks: [{ ...task(id!, T3, { workloads: [amount('chapters', 'target', 3, 'chapter', '章', '3章ぶん')],
        effortEstimates: [{ localId: 'rate', targetLocalId: 'chapters', kind: 'duration_per_unit', minutes: 40, unitCode: 'chapter', precision: 'approximate', sourceText: '1章40分' }] }), title: '化学の参考書' }] });
    });
    const conversation = open();
    await conversation.submit(T1);
    expect(slot(conversation)).toBe('stable_v5:semantic_uncertainty');
    const answered = await conversation.submit(T3);
    expect(answered.result?.failure).toBeUndefined();
    expect(active(conversation).workloads).toEqual([expect.objectContaining({ quantityRole: 'target', amount: 3, unitCode: 'chapter' })]);
    expect(minutes(conversation)).toBeGreaterThan(0);
  });
  it('(c) registered-material target scope: a plan amount binds as the target (no demotion) and previews', async () => {
    const note = { id: 'material-note', userId: 'issue488-owner', name: '卒業研究ノート', subjectId: 's', subjectName: '卒業研究', paceEnabled: true, progressUnit: 'section',
      totalUnits: 12, currentUnit: 5, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
    const T1 = '来週は卒業研究ノートを進めたい';
    const T2 = '3セクション進める。1セクション30分';
    install((text, id) => text === T1
      ? doc({ planningIntent: 'create_plan', planningWindow: week, tasks: [{ ...task(null, '卒業研究ノートを進めたい'), title: '卒業研究ノート', decompositionStatus: 'atomic' }] })
      : doc({ tasks: [{ ...task(id!, T2, { workloads: [amount('sections', 'target', 3, 'section', 'セクション', '3セクション')],
        effortEstimates: [{ localId: 'rate2', targetLocalId: 'sections', kind: 'duration_per_unit', minutes: 30, unitCode: 'section', precision: 'approximate', sourceText: '1セクション30分' }] }), title: '卒業研究ノート' }] }));
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-12', studyMaterials: [note as never], now: () => '2026-10-08T00:00:00.000Z' });
    await conversation.submit(T1);
    expect(slot(conversation)).toBe('stable_v5:missing_schedulable_work');
    await conversation.submit(T2);
    expect(active(conversation).workloads.some(w => w.quantityRole === 'declared')).toBe(false);
    expect(active(conversation).workloads).toEqual([expect.objectContaining({ quantityRole: 'target', amount: 3, unitCode: 'section' })]);
  });
});

describe('end state (b′): the role confirmation of a declared amount is presented once, never on consecutive turns', () => {
  const SESSION = '1回1時間くらいで';
  const DELEGATE = 'お任せします';
  const liveF = (text: string, id: string | undefined): Json => text === T1_UNQUANTIFIED
    ? doc({ planningIntent: 'create_plan', planningWindow: week, tasks: [task(null, '卒研を進めたい', { temporalConstraints: [night('できれば夜')] })] })
    : text === BUDGET ? doc({ tasks: [task(id!, text, { effortEstimates: [total(120, text)] })] })
      : text === SESSION ? doc({ tasks: [task(id!, text, { effortEstimates: [{ localId: 'e-session', targetLocalId: 'thesis', kind: 'session_duration', minutes: 60, unitCode: 'session', precision: 'approximate', sourceText: text }] })] })
        : text === CONFIRM ? doc({ tasks: [task(id!, text, { workloads: [amount('confirm', 'target', 120, 'minute', '分', text)] })] })
          : doc({ tasks: [task(id!, text)] });
  const asked = (turn: { calls: ScriptedProviderCall[] }) => {
    const decision = turn.calls.filter(call => call.kind === 'renderer').pop()?.payload?.applicationDecision as Json | undefined;
    return decision?.actionKind === 'question' ? String(decision.questionCode) : null;
  };

  it('the full live-F script: the role confirmation is presented exactly once; 「1回1時間くらいで」 binds the session length instead of re-asking', async () => {
    install(liveF);
    const conversation = open();
    const presented: Array<string | null> = [];
    const first = await conversation.submit(T1_UNQUANTIFIED); presented.push(asked(first));
    const second = await conversation.submit(BUDGET); presented.push(asked(second));
    const third = await conversation.submit(SESSION); presented.push(asked(third));
    for (const text of [DELEGATE, DELEGATE, DELEGATE]) presented.push(asked(await conversation.submit(text)));
    // The measured pre-fix sequence was missing_schedulable_work, then quantity_role_unresolved on EVERY later turn.
    expect(presented.filter(code => code === 'quantity_role_unresolved')).toHaveLength(1);
    expect(presented[1]).toBe('quantity_role_unresolved');
    expect(presented.filter(code => code === 'missing_schedulable_work')).toHaveLength(1);
    for (let index = 1; index < presented.length; index += 1) {
      expect(presented[index] === null || presented[index] !== presented[index - 1]).toBe(true);
    }
    expect(active(conversation).efforts.filter(effort => effort.kind === 'session_duration')).toEqual([expect.objectContaining({ minutes: 60 })]);
    expect(minutes(conversation)).toBe(0);
    expect(conversation.getState().intakeState?.status).not.toBe('draft_ready');
  });
  it('a role answer after the held turns still applies (the retained question stays answerable) and previews', async () => {
    install(liveF);
    const conversation = open();
    for (const text of [T1_UNQUANTIFIED, BUDGET, SESSION, DELEGATE]) await conversation.submit(text);
    const confirmed = await conversation.submit(CONFIRM);
    expect(confirmed.result?.failure).toBeUndefined();
    expect(active(conversation).workloads).toEqual([expect.objectContaining({ quantityRole: 'target', amount: 120, unitCode: 'minute' })]);
    expect(minutes(conversation)).toBe(120);
  });
  it('freshness, both ways: a bare 「はい」 and an unrelated amount in a later turn do NOT bind to the waiting role', async () => {
    const YES = 'はい';
    const OTHER = '30分だけやる';
    install((text, id) => text === YES
      ? doc({ tasks: [task(id!, text)], conversationActs: [{ kind: 'answer_pending_question', targetPublicId: id ?? null }] })
      : text === OTHER ? doc({ tasks: [task(id!, text, { workloads: [amount('other', 'target', 30, 'minute', '分', text)] })] })
        : liveF(text, id));
    const conversation = open();
    for (const text of [T1_UNQUANTIFIED, BUDGET, SESSION, DELEGATE, YES, OTHER]) await conversation.submit(text);
    const waiting = active(conversation).workloads.find(w => w.amount === 120);
    expect(waiting).toMatchObject({ quantityRole: 'declared', unitCode: 'minute' });
    expect(active(conversation).workloads.filter(w => w.amount === 120 && w.quantityRole === 'target')).toEqual([]);
  });
  it('freshness, the other way: the amount restated with its role applies it; 「これからやる分」 applies it', async () => {
    install(liveF);
    const conversation = open();
    for (const text of [T1_UNQUANTIFIED, BUDGET, SESSION, DELEGATE]) await conversation.submit(text);
    await conversation.submit(CONFIRM);
    expect(active(conversation).workloads.filter(w => w.amount === 120).map(w => w.quantityRole)).toEqual(['target']);
  });
  it('the held turn carries the open item as a typed planning need and asks no question', async () => {
    install(liveF);
    const conversation = open();
    await conversation.submit(T1_UNQUANTIFIED);
    await conversation.submit(BUDGET);
    const held = await conversation.submit(DELEGATE);
    const decision = held.calls.filter(call => call.kind === 'renderer').pop()?.payload?.applicationDecision as Json;
    expect(decision.actionKind).not.toBe('question');
    expect((decision.communication as Json).planningNeeds).toEqual([expect.objectContaining({ need: 'role_unresolved', amount: 120, unitCode: 'minute' })]);
  });
  it('legacy_v5 is untouched (no hold, no planning needs)', async () => {
    provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, '');
      const id = (((call.payload?.publicStateSummary as Json | undefined)?.tasks ?? []) as Json[])[0]?.publicId as string | undefined;
      const d = liveF(String(call.payload?.userText ?? ''), id);
      delete d.conversationActs;
      return JSON.stringify(d);
    });
    const conversation = open('legacy_v5');
    let last;
    for (const text of [T1_UNQUANTIFIED, BUDGET, DELEGATE]) last = await conversation.submit(text);
    // Legacy keeps promoting the budget and has no communication facts at all (no hold, no planning needs).
    expect(minutes(conversation)).toBe(120);
    expect(last?.result?.communicationFacts).toBeUndefined();
  });
});

describe('the waiting amount is a verified mustConvey fact (P2): omitted or contradicted replies never pass', () => {
  const liveF = (text: string, id: string | undefined): Json => text === T1_UNQUANTIFIED
    ? doc({ planningIntent: 'create_plan', planningWindow: week, tasks: [task(null, '卒研を進めたい', { temporalConstraints: [night('できれば夜')] })] })
    : text === BUDGET ? doc({ tasks: [task(id!, text, { effortEstimates: [total(120, text)] })] })
      : doc({ tasks: [task(id!, text)] });
  const DELEGATE = 'お任せします';
  async function heldTurn() {
    install(liveF);
    const conversation = open();
    await conversation.submit(T1_UNQUANTIFIED);
    await conversation.submit(BUDGET);
    const before = { revision: conversation.graph()!.revision, workloads: JSON.stringify(active(conversation).workloads.map(w => [w.id, w.quantityRole, w.amount])) };
    const turnCalls = () => provider.calls.filter(call => call.kind === 'renderer' || call.kind === 'reply_verifier');
    const prior = turnCalls().length;
    const turn = await conversation.submit(DELEGATE);
    return { conversation, turn, before, calls: turnCalls().slice(prior) };
  }
  it('the held turn carries the entry exactly as agreed: {code, factId, quote, amount, unitCode}', async () => {
    const { turn } = await heldTurn();
    const entry = waitingEntry(turn.calls.filter(call => call.kind === 'renderer').pop()!);
    expect(entry).toEqual({ code: 'declared_amount_waiting', factId: expect.stringMatching(/^wpf_workload_/), quote: BUDGET, amount: 120, unitCode: 'minute' });
  });
  it('the role-question turn carries NO waiting entry (the question itself conveys it); only the next held turn carries exactly one', async () => {
    install(liveF);
    const conversation = open();
    await conversation.submit(T1_UNQUANTIFIED);
    const questionTurn = await conversation.submit(BUDGET);
    const questionCalls = questionTurn.calls.filter(call => call.kind === 'renderer');
    expect(questionCalls.length).toBeGreaterThan(0);
    for (const call of questionCalls) expect(waitingEntry(call)).toBeUndefined();
    const held = await conversation.submit(DELEGATE);
    const entries = held.calls.filter(call => call.kind === 'renderer').map(waitingEntry).filter(Boolean);
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries.map(entry => JSON.stringify(entry))).size).toBe(1);
  });
  it('a faithful reply passes (AI-written, writer + one verifier call)', async () => {
    const { turn, calls } = await heldTurn();
    expect(turn.result?.responseSource).toBe('ai');
    expect(turn.result?.message).toContain(BUDGET);
    expect(calls.map(call => call.kind)).toEqual(['renderer', 'reply_verifier']);
  });
  it('a reply that omits the amount is regenerated once and then stops: graph and workloads unchanged, no claim', async () => {
    rendererOverride = () => 'わかりました。';
    const { conversation, turn, before, calls } = await heldTurn();
    expect(turn.result?.failure?.code).toBe('stable_v5_dialogue_verification_failed');
    expect(turn.result?.message).toBe(WEEKLY_PLANNING_VERIFIED_DIALOGUE_TECHNICAL_STOP_TEXT);
    expect(calls.filter(call => call.kind === 'renderer')).toHaveLength(2);
    expect(conversation.graph()!.revision).toBe(before.revision);
    expect(JSON.stringify(active(conversation).workloads.map(w => [w.id, w.quantityRole, w.amount]))).toBe(before.workloads);
    expect(minutes(conversation)).toBe(0);
  });
  it('a reply that says the amount was applied or planned with is contradicted, regenerated once, then stops', async () => {
    verifierOverride = call => JSON.stringify({
      verdicts: (((call.payload?.required as Array<{ key: string }> | undefined) ?? []).map(item => ({ key: item.key, verdict: 'contradicted' }))), forbidden: [],
    });
    rendererOverride = (_call, waiting) => `「${waiting?.quote}」の${waiting?.amount}分を前提に、そのまま進めています。`;
    const { conversation, turn, before, calls } = await heldTurn();
    expect(turn.result?.failure?.code).toBe('stable_v5_dialogue_verification_failed');
    expect(calls.map(call => call.kind)).toEqual(['renderer', 'reply_verifier', 'renderer', 'reply_verifier']);
    expect(conversation.graph()!.revision).toBe(before.revision);
    expect(minutes(conversation)).toBe(0);
  });
  it('a reply that offers a preview while the amount waits (forbidden claim) is rejected', async () => {
    verifierOverride = call => JSON.stringify({
      verdicts: (((call.payload?.required as Array<{ key: string }> | undefined) ?? []).map(item => ({ key: item.key, verdict: 'stated_accurately' }))), forbidden: ['preview_offered'],
    });
    const { turn } = await heldTurn();
    expect(turn.result?.failure?.code).toBe('stable_v5_dialogue_verification_failed');
  });
});
