import { afterEach, describe, expect, it } from 'vitest';
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { acceptingReplyVerifierReply } from './testUtils/weeklyPlanningExamOverloadFixture';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply,
  type ScriptedConversation, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

/*
 * Issue #488 P3 S3a: the renderer declares the PURPOSE of the amount question it writes (typed envelope field `askedPurpose`, no extra call).
 * The application validates it against the typed planning needs and the free calendar, holds it on the pending question
 * (`intent = purpose:<enum>`), and the S1 guard only DEMOTES against it (never upgrades, never fills a missing role). The semantic
 * readers never see the declaration.
 */
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let declared: ((call: ScriptedProviderCall) => unknown) | null = null;
let shownCheck: ((call: ScriptedProviderCall) => string) | null = null;
let rendererText = 'どのくらい進めたいですか？';
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); declared = null; shownCheck = null; rendererText = 'どのくらい進めたいですか？'; });

const doc = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
  availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...o });
const week = { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
const task = (id: string | null, sourceText: string, extra: Json = {}): Json => ({ localId: 'thesis', existingPublicId: id, decompositionStatus: 'atomic', category: 'study', title: '卒研',
  study: { purpose: 'self_study', activityKind: 'other', contextLabel: null, components: [] }, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [],
  durableContextSignals: [], sourceText, ...extra });
const amount = (id: string, role: string, n: number, unit: string, label: string, text: string): Json => ({ localId: id, quantityRole: role, amount: n, unitCode: unit, unitLabel: label,
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: text });

const note = { id: 'material-note', userId: 'issue488-owner', name: '卒業研究ノート', subjectId: 's', subjectName: '卒業研究', paceEnabled: true, progressUnit: 'section',
  totalUnits: 12, currentUnit: 5, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
const M1 = '来週は卒業研究ノートを進めたい';
const M2 = '3セクション進める。1セクション30分';
const F1 = '来週は卒研を進めたい。できれば夜';
const F2 = '合計2時間くらい';

function install(script: (text: string, taskId: string | undefined) => Json) {
  let lastText = '';
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'reply_verifier') return acceptingReplyVerifierReply(call);
    if (call.kind === 'renderer') {
      const reply = JSON.parse(scriptedRendererReply(call, rendererText)) as Json;
      const askedPurpose = declared?.(call);
      return JSON.stringify(askedPurpose === undefined ? reply : { ...reply, askedPurpose });
    }
    if (call.kind === 'shown_question_purpose') return (shownCheck ?? (() => JSON.stringify({ purpose: 'plan' })))(call);
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') {
      return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    }
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') {
      return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    }
    const text = String(call.payload?.userText ?? lastText);
    lastText = text;
    const taskId = (((call.payload?.publicStateSummary as Json | undefined)?.tasks ?? []) as Json[])[0]?.publicId as string | undefined;
    return JSON.stringify(script(text, taskId));
  }, { shownQuestionPurpose: 'scripted' });
}
const material = (text: string, id: string | undefined): Json => text === M1
  ? doc({ planningIntent: 'create_plan', planningWindow: week, tasks: [{ ...task(null, M1), title: '卒業研究ノート' }] })
  : doc({ tasks: [{ ...task(id!, M2, { workloads: [amount('sections', 'target', 3, 'section', 'セクション', '3セクション')],
    effortEstimates: [{ localId: 'rate', targetLocalId: 'sections', kind: 'duration_per_unit', minutes: 30, unitCode: 'section', precision: 'approximate', sourceText: '1セクション30分' }] }), title: '卒業研究ノート' }] });
const thesis = (text: string, id: string | undefined): Json => text === F1
  ? doc({ planningIntent: 'create_plan', planningWindow: week, tasks: [task(null, '卒研を進めたい')] })
  : doc({ tasks: [task(id!, text, { effortEstimates: [{ localId: 'e-total', targetLocalId: 'thesis', kind: 'total_duration', minutes: 120, unitCode: null, precision: 'approximate', sourceText: F2 }] })] });
const open = () => createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-12', studyMaterials: [note as never], now: () => '2026-10-08T00:00:00.000Z' });
const openLegacy = () => createScriptedConversation({ provider, architecture: 'legacy_v5', weekStartDate: '2026-10-12', studyMaterials: [note as never], now: () => '2026-10-08T00:00:00.000Z' });
const slot = (c: ScriptedConversation) => c.getState().intakeState?.lastQuestionContext?.targetSlot;
const heldIntent = (c: ScriptedConversation) => c.getState().intakeState?.lastQuestionContext?.intent;
const workloads = (c: ScriptedConversation) => {
  const graph = c.graph()!;
  const ids = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
  return graph.workloads.filter(w => ids.has(w.id));
};
const rendererCalls = (turn: { calls: ScriptedProviderCall[] }) => turn.calls.filter(call => call.kind === 'renderer');
const communicationOf = (call: ScriptedProviderCall) => ((call.payload?.applicationDecision as Json | undefined)?.communication ?? {}) as Json;

describe('the envelope: only an amount question the AI chooses carries the typed purpose field, interaction only', () => {
  it('the amount question offers the purposes the typed needs allow (available_time is not offered: the calendar already answers it)', async () => {
    install(material);
    const turn = await open().submit(M1);
    const call = rendererCalls(turn).pop()!;
    expect(call.schemaProperties).toContain('askedPurpose');
    expect(communicationOf(call).askedPurposeOptions).toEqual(['current_progress', 'planned_amount', 'per_session_length', 'wish', 'days', 'open_point']);
  });
  it('a turn that is not an amount question has no envelope field and no options', async () => {
    declared = () => 'current_progress';
    install(material);
    const conversation = open();
    await conversation.submit(M1);
    const second = await conversation.submit(M2);
    for (const call of rendererCalls(second)) {
      expect(call.schemaProperties).not.toContain('askedPurpose');
      expect(communicationOf(call).askedPurposeOptions).toBeUndefined();
    }
  });
  it('legacy_v5 is untouched: no field, no options', async () => {
    install(material);
    const turn = await openLegacy().submit(M1);
    for (const call of rendererCalls(turn)) {
      expect(call.schemaProperties).not.toContain('askedPurpose');
      expect(communicationOf(call).askedPurposeOptions).toBeUndefined();
    }
  });
});

describe('the declared purpose is validated, held on the pending question, and only demotes', () => {
  it('a declared current_progress holds `purpose:current_progress`; a plan amount answering it is demoted to the role confirmation', async () => {
    declared = () => 'current_progress';
    install(material);
    const conversation = open();
    await conversation.submit(M1);
    expect(heldIntent(conversation)).toBe('purpose:current_progress');
    await conversation.submit(M2);
    expect(workloads(conversation).filter(w => w.quantityRole === 'target')).toEqual([]);
    expect(workloads(conversation).some(w => w.quantityRole === 'declared')).toBe(true);
    expect(slot(conversation)).toBe('stable_v5:quantity_role_unresolved');
  });
  it('a declared planned_amount holds nothing that demotes: the same answer binds as the target (control)', async () => {
    declared = () => 'planned_amount';
    install(material);
    const conversation = open();
    await conversation.submit(M1);
    await conversation.submit(M2);
    expect(workloads(conversation)).toEqual([expect.objectContaining({ quantityRole: 'target', amount: 3, unitCode: 'section' })]);
  });
  it('never an upgrade: a declared planned_amount does not lift the application-derived progress demotion', async () => {
    declared = () => 'planned_amount';
    install(thesis);
    const conversation = open();
    await conversation.submit(F1);
    await conversation.submit(F2);
    expect(workloads(conversation).filter(w => w.quantityRole === 'target')).toEqual([]);
    expect(workloads(conversation)).toEqual([expect.objectContaining({ quantityRole: 'declared', amount: 120 })]);
  });
  it('a declared per_session_length demotes a plan total answering it (one role confirmation, never a wrong binding)', async () => {
    declared = () => 'per_session_length';
    install(material);
    const conversation = open();
    await conversation.submit(M1);
    expect(heldIntent(conversation)).toBe('purpose:per_session_length');
    await conversation.submit(M2);
    expect(workloads(conversation).filter(w => w.quantityRole === 'target')).toEqual([]);
    expect(slot(conversation)).toBe('stable_v5:quantity_role_unresolved');
  });
  it('a neutral declaration (open_point) holds nothing that demotes: the answer binds as before', async () => {
    install(material);
    const conversation = open();
    await conversation.submit(M1);
    expect(heldIntent(conversation)).toBe('purpose:open_point');
    await conversation.submit(M2);
    expect(workloads(conversation)).toEqual([expect.objectContaining({ quantityRole: 'target', amount: 3 })]);
  });
});

describe('an invalid declaration is regenerated once and never held', () => {
  it('available_time while the calendar already answers it: regenerated once; a valid second declaration passes (2 renderer calls)', async () => {
    let n = 0;
    declared = () => (n++ === 0 ? 'available_time' : 'current_progress');
    install(material);
    const conversation = open();
    const turn = await conversation.submit(M1);
    expect(rendererCalls(turn)).toHaveLength(2);
    expect(turn.result?.responseSource).toBe('ai');
    expect(heldIntent(conversation)).toBe('purpose:current_progress');
  });
  it('still invalid after the one regeneration: the deterministic fallback, nothing held', async () => {
    declared = () => 'available_time';
    install(material);
    const conversation = open();
    const turn = await conversation.submit(M1);
    expect(rendererCalls(turn)).toHaveLength(2);
    expect(turn.result?.responseSource).toBe('deterministic_fallback');
    expect(heldIntent(conversation)).not.toMatch(/^purpose:/);
  });
  it('an unknown value or a missing field on a question that offered the options is invalid the same way', async () => {
    for (const bad of ['xyz', null, 5]) {
      declared = () => bad;
      install(material);
      const turn = await open().submit(M1);
      expect(rendererCalls(turn)).toHaveLength(2);
      expect(turn.result?.responseSource).toBe('deterministic_fallback');
      provider.restore(); resetScriptedConversationRuntime();
    }
  });
});

describe('nothing derived from the declaration reaches a reader', () => {
  it('the AI declares per_session_length, the user answers the total: no semantic payload carries the declaration, outcome is one role confirmation', async () => {
    declared = () => 'per_session_length';
    install(material);
    const conversation = open();
    await conversation.submit(M1);
    const second = await conversation.submit(M2);
    for (const call of second.calls.filter(entry => entry.kind.startsWith('semantic'))) {
      expect(JSON.stringify(call.messages)).not.toMatch(/per_session_length|askedPurpose|purpose:/);
      const pending = ((call.payload?.publicStateSummary as Json | undefined)?.pendingQuestion ?? {}) as Json;
      expect(Object.keys(pending).sort()).toEqual(['actionId', 'effortMeasurement', 'estimateForWorkloadFactId', 'graphRevision', 'questionBasis', 'questionCode', 'targetFactId']);
      expect(pending.effortMeasurement ?? null).toBeNull();
    }
    expect(slot(conversation)).toBe('stable_v5:quantity_role_unresolved');
  });
});

describe('reload mid-conversation (critic 4219): a bare 「はい」 binds nothing from an amount the history text mentioned', () => {
  it('the question text proposes 2 hours, the session is reloaded from the persisted state, 「はい」 creates no workload and no plan', async () => {
    declared = () => 'planned_amount';
    install((text, id) => text === M1
      ? material(text, id)
      : doc({ tasks: [task(id ?? null, text)] }));
    const first = open();
    await first.submit(M1);
    const persisted = first.getState();
    resetScriptedConversationRuntime();
    const reloaded = createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-12', studyMaterials: [note as never],
      now: () => '2026-10-08T00:00:00.000Z', initialState: persisted });
    await reloaded.submit('はい');
    const graph = reloaded.graph();
    const active = new Set((graph?.factLifecycles ?? []).filter(entry => entry.status === 'active').map(entry => entry.factId));
    expect((graph?.workloads ?? []).filter(w => active.has(w.id) && w.quantityRole === 'target')).toEqual([]);
    expect((reloaded.getState().previewCandidates ?? []).length).toBe(0);
  });
});

describe('S3a v2 (critics 4240/4247): an amount answering an amount question binds as a plan target only when the shown question was a plan question', () => {
  const PROGRESS_TEXT = '今どこまで進んでいますか？';
  const BARE = (text: string, id: string | undefined): Json => text === M1
    ? doc({ planningIntent: 'create_plan', planningWindow: week, tasks: [{ ...task(null, M1), title: '卒業研究ノート' }] })
    : doc({ tasks: [{ ...task(id!, F2, { effortEstimates: [{ localId: 'e-total', targetLocalId: 'thesis', kind: 'total_duration', minutes: 120, unitCode: null, precision: 'approximate', sourceText: F2 }] }), title: '卒業研究ノート' }] });
  const TARGET = (text: string, id: string | undefined): Json => text === M1
    ? BARE(text, id)
    : doc({ tasks: [{ ...task(id!, F2, { workloads: [amount('w-target', 'target', 120, 'minute', '分', F2)] }), title: '卒業研究ノート' }] });
  const COMPLETED = (text: string, id: string | undefined): Json => text === M1
    ? BARE(text, id)
    : doc({ tasks: [{ ...task(id!, F2, { workloads: [amount('w-done', 'completed', 2, 'hour', '時間', '2時間')] }), title: '卒業研究ノート' }] });
  const checkCalls = (turn: { calls: ScriptedProviderCall[] }) => turn.calls.filter(call => call.kind === 'shown_question_purpose');
  const targets = (c: ScriptedConversation) => workloads(c).filter(w => w.quantityRole === 'target');
  const answer = async (script: (text: string, id: string | undefined) => Json, purpose: string | (() => string)) => {
    declared = () => 'planned_amount';
    rendererText = PROGRESS_TEXT;
    shownCheck = () => (typeof purpose === 'function' ? purpose() : JSON.stringify({ purpose }));
    install((text, id) => (text === F2 ? script(text, id) : script(M1, id)));
    const conversation = open();
    await conversation.submit(M1);
    const turn = await conversation.submit(F2);
    return { conversation, turn };
  };

  it('probe 51 (bare budget): the AI text asked progress while the declaration said planned_amount — the check reads the shown text, no silent 2h plan', async () => {
    const { conversation, turn } = await answer(BARE, 'progress');
    expect(checkCalls(turn)).toHaveLength(1);
    expect(targets(conversation)).toEqual([]);
    expect(workloads(conversation)).toEqual([expect.objectContaining({ quantityRole: 'declared', amount: 120, unitCode: 'minute' })]);
    expect(slot(conversation)).toBe('stable_v5:quantity_role_unresolved');
  });
  it('probe 51 (target-typed reading, critic 4247): the same answer typed as an explicit target is demoted too', async () => {
    const { conversation, turn } = await answer(TARGET, 'progress');
    expect(checkCalls(turn)).toHaveLength(1);
    expect(targets(conversation)).toEqual([]);
    expect(workloads(conversation)).toEqual([expect.objectContaining({ quantityRole: 'declared', amount: 120 })]);
  });
  it('a plan question: the check says plan, the answer binds as the target (one extra call)', async () => {
    const { conversation, turn } = await answer(BARE, 'plan');
    expect(checkCalls(turn)).toHaveLength(1);
    expect(workloads(conversation).some(w => w.quantityRole === 'declared')).toBe(false);
    const graph = conversation.graph()!;
    const live = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    expect(graph.effortEstimates.filter(effort => live.has(effort.id) && effort.kind === 'total_duration')).toEqual([expect.objectContaining({ minutes: 120 })]);
  });
  it('other, or an unavailable check (malformed reply / throw), declares the amount: one role confirmation, never a guess', async () => {
    for (const purpose of [JSON.stringify({ purpose: 'other' }), 'not json', JSON.stringify({ purpose: 'xyz' })]) {
      const { conversation, turn } = await answer(BARE, () => purpose);
      expect(checkCalls(turn)).toHaveLength(1);
      expect(targets(conversation)).toEqual([]);
      expect(workloads(conversation).some(w => w.quantityRole === 'declared' && w.amount === 120)).toBe(true);
      provider.restore(); resetScriptedConversationRuntime();
    }
  });
  it('progress keeps a completed amount (the guard demotes only plan amounts)', async () => {
    const { conversation } = await answer(COMPLETED, 'progress');
    expect(workloads(conversation)).toEqual([expect.objectContaining({ quantityRole: 'completed', amount: 2, unitCode: 'hour' })]);
  });
  it('the check reads the question text alone: the request carries neither the user answer nor the declaration', async () => {
    const { turn } = await answer(BARE, 'progress');
    const call = checkCalls(turn)[0];
    const sent = JSON.stringify(call.messages);
    expect(sent).toContain(PROGRESS_TEXT);
    expect(sent).not.toContain(F2);
    expect(sent).not.toMatch(/planned_amount|askedPurpose|purpose:/);
  });
  it('no call when a demoting purpose is already held (the live-F S1 path), and none in legacy_v5', async () => {
    install(thesis);
    const conversation = open();
    await conversation.submit(F1);
    const second = await conversation.submit(F2);
    expect(checkCalls(second)).toHaveLength(0);
    provider.restore(); resetScriptedConversationRuntime();
    install(thesis);
    const legacy = openLegacy();
    await legacy.submit(F1);
    expect(checkCalls(await legacy.submit(F2))).toHaveLength(0);
  });
});
