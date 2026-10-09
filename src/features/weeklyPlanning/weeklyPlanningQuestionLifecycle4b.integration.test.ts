import { afterEach, describe, expect, it } from 'vitest';
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

/*
 * Issue #488 round 4b, X3-T3 (live): the user states a content quantity and its rate in one clause.
 * The reading binds the task, adds the workload and quotes the whole clause for the workload, so the
 * quote "covers" the rate that no typed effort represents. Literal coverage must not treat a quote as
 * covering digits that its own typed values do not account for: the completeness audit has to run.
 */
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const T1 = '来週、化学の参考書を進めたいんだけど、どのくらい時間がかかるか見当がつかない';
const T3 = 'じゃあ3章ぶん、1章40分で見ておく';
const AUDIT = 'weekly_planning_dense_turn_completeness_audit_v5';
const doc = (o: Json = {}): Json => ({
  schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
  availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
  conversationActs: [], ...o,
});
const task = (id: string | null, sourceText: string, extra: Json = {}): Json => ({
  localId: 'chem', existingPublicId: id, decompositionStatus: 'needs_breakdown', category: 'study', title: '化学の参考書',
  study: { purpose: 'self_study', activityKind: 'other', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
  temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText, ...extra,
});
const chapters = (sourceText: string): Json => ({
  localId: 'wl', quantityRole: 'target', amount: 3, unitCode: 'chapter', unitLabel: '章', rangeStart: null, rangeEnd: null,
  perOccurrence: false, periodExpression: null, sourceText,
});

describe('X3-T3: a workload quote that carries a rate the typed values do not account for', () => {
  it.each(['3章ぶん、1章40分', '3章ぶん'])('workload quote %s: the completeness audit runs', async quote => {
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
      if (call.schemaName === AUDIT) return JSON.stringify({ decision: 'complete', missingFacts: [] });
      if (call.kind !== 'semantic_generic') {
        return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
      }
      const text = String(call.payload?.userText ?? '');
      const id = (((call.payload?.publicStateSummary as Json)?.tasks ?? []) as Json[])[0]?.publicId as string | undefined;
      if (text === T1) {
        return JSON.stringify(doc({
          planningIntent: 'create_plan',
          planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
          tasks: [task(null, '化学の参考書を進めたい')],
          uncertainties: [{ localId: 'u', targetLocalId: 'chem', field: 'work_breakdown', reason: 'r', sourceText: '化学の参考書を進めたい' }],
        }));
      }
      return JSON.stringify(doc({ tasks: [task(id!, quote, { workloads: [chapters(quote)] })] }));
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
    await conversation.submit(T1);
    const third = await conversation.submit(T3);
    expect(third.calls.some(call => call.schemaName === AUDIT)).toBe(true);
  });
});

describe('H-T2 (path i): a dropped advisory uncertainty still accounts for its quote', () => {
  const H1 = '来週、レポートの文献を30ページ読む。1ページ3分くらい';
  const H2 = 'あ、やっぱり25ページで、1ページ3分のまま。あとこれって1日でまとめて読んでも平気？';
  const CONSULT_QUOTE = 'あとこれって1日でまとめて読んでも平気？';
  it.each([
    { flag: false, field: 'one_day_completion_feasibility', audits: false },
    { flag: true, field: 'one_day_completion_feasibility', audits: false },
    { flag: false, field: 'work_breakdown', audits: false },
  ])('flag=$flag field=$field: completeness audit dispatched=$audits', async ({ flag, field, audits }) => {
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
      if (call.schemaName === AUDIT) return JSON.stringify({ decision: 'complete', missingFacts: [] });
      if (call.kind !== 'semantic_generic') {
        return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
      }
      const text = String(call.payload?.userText ?? '');
      const id = (((call.payload?.publicStateSummary as Json)?.tasks ?? []) as Json[])[0]?.publicId as string | undefined;
      const paper = (existing: string | null, sourceText: string, extra: Json = {}): Json => ({
        localId: 'paper', existingPublicId: existing, decompositionStatus: 'atomic', category: 'study', title: 'レポートの文献',
        study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
        temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText, ...extra,
      });
      const pages = (amount: number, id2: string, q: string): Json => ({ localId: id2, quantityRole: 'target', amount, unitCode: 'page', unitLabel: 'ページ',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: q });
      const rate = (id2: string, target: string, q: string): Json => ({ localId: id2, targetLocalId: target, kind: 'duration_per_unit', minutes: 3,
        unitCode: 'page', precision: 'approximate', sourceText: q });
      if (text === H1) {
        return JSON.stringify(doc({ planningIntent: 'create_plan', planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
          tasks: [paper(null, '文献を30ページ読む', { workloads: [pages(30, 'a1', '30ページ')], effortEstimates: [rate('r1', 'a1', '1ページ3分')] })] }));
      }
      return JSON.stringify(doc({
        tasks: [paper(id!, 'やっぱり25ページで', { workloads: [pages(25, 'a2', '25ページ')], effortEstimates: [rate('r2', 'a2', '1ページ3分')] })],
        uncertainties: [{ localId: 'u', targetLocalId: 'paper', field, reason: 'r', sourceText: CONSULT_QUOTE, blocksPlanning: flag }],
        conversationActs: [{ kind: 'consultation_request', targetPublicId: id }],
      }));
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
    await conversation.submit(H1);
    const second = await conversation.submit(H2);
    expect(second.calls.some(call => call.schemaName === AUDIT)).toBe(audits);
  });

  it('a digit run the workload cannot account for (「第3章を20ページ」) triggers an audit: cost, not harm', async () => {
    const text = 'じゃあ第3章を20ページで見ておく';
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
      if (call.schemaName === AUDIT) return JSON.stringify({ decision: 'complete', missingFacts: [] });
      if (call.kind !== 'semantic_generic') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
      const t = String(call.payload?.userText ?? '');
      const id = (((call.payload?.publicStateSummary as Json)?.tasks ?? []) as Json[])[0]?.publicId as string | undefined;
      if (t === T1) return JSON.stringify(doc({ planningIntent: 'create_plan', planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' }, tasks: [task(null, '化学の参考書を進めたい')] }));
      return JSON.stringify(doc({ tasks: [task(id!, '第3章を20ページ', { workloads: [{ ...chapters('第3章を20ページ'), amount: 20, unitCode: 'page', unitLabel: 'ページ' }] })] }));
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
    await conversation.submit(T1);
    const turn = await conversation.submit(text);
    expect(turn.calls.some(call => call.schemaName === AUDIT)).toBe(true);
  });
});
