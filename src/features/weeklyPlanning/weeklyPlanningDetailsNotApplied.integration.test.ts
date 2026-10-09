import { afterEach, describe, expect, it } from 'vitest';
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply,
  type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import { WEEKLY_PLANNING_DETAILS_NOT_APPLIED_TEXT, weeklyPlanningDetailsNotAppliedNotice } from './dialogue/weeklyPlanningDetailsNotAppliedDisclosure';
import { WEEKLY_PLANNING_NOTHING_READ_TEXT } from './dialogue/weeklyPlanningNothingReadDisclosure';

/*
 * Issue #488 x10 (live round 6 H T2): the planning delta of a message was rejected (a dangling workload correction)
 * and the turn went on through its consultation act. The AI-rendered reply never said the 25-page change was not
 * taken in (disclosure depended on the renderer's prompt). The application states it, once, beside the reply.
 */
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const T1 = '来週、レポートの文献を30ページ読む。1ページ3分くらい';
const T2 = 'あ、やっぱり25ページで。あとこれって1日でまとめて読んでも平気？';
const T2_PURE = 'ところで、これって1日でまとめて読んでも平気？';
const doc = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
  availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...o });
const paper = (id: string | null, extra: Json = {}): Json => ({ localId: 'paper', existingPublicId: id, decompositionStatus: 'atomic', category: 'study', title: 'レポートの文献',
  study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] }, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [],
  durableContextSignals: [], sourceText: '文献を30ページ読む', ...extra });
const amount = (n: number, text: string): Json => ({ localId: `a${n}`, quantityRole: 'target', amount: n, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: text });

function install(rendererText: string | null) {
  let lastText = '';
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, rendererText ?? '');
    // A repair call carries no userText: it answers the same turn as the call before it.
    const text = String(call.payload?.userText ?? lastText);
    lastText = text;
    const taskId = (((call.payload?.publicStateSummary as Json | undefined)?.tasks ?? []) as Json[])[0]?.publicId as string | undefined;
    if (text === T1) {
      return JSON.stringify(doc({ planningIntent: 'create_plan', planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
        tasks: [paper(null, { workloads: [amount(30, '30ページ')], effortEstimates: [{ localId: 'r', targetLocalId: 'a30', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'approximate', sourceText: '1ページ3分' }] })] }));
    }
    const consult = { kind: 'consultation_request', targetPublicId: taskId };
    if (text === T2) {
      // A planning delta that is invalid in every read and that no focused repair covers (a workload whose amount is not a positive number), plus the
      // consultation act that carries the turn: the live H T2 outcome (delta rejected, conversation-only route). The live
      // dangling-replacement shape applies after x9b/x9c, so this pin deliberately uses a shape that stays rejected.
      return JSON.stringify(doc({
        tasks: [paper(taskId!, { sourceText: 'やっぱり25ページで', workloads: [amount(-25, '25ページ')] })],
        conversationActs: [consult],
      }));
    }
    return JSON.stringify(doc({ conversationActs: [consult] }));
  });
}
const open = () => createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
const GOOD = 'ご質問の件は、いっしょに考えていきましょう。';
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe('x10: a rejected planning delta is stated by the application on the AI-rendered path', () => {
  it('live H T2 shape (rejected delta + consultation act): the sentence is present once, beside the AI reply', async () => {
    install(GOOD);
    const conversation = open();
    await conversation.submit(T1);
    const second = await conversation.submit(T2);
    expect(second.result?.communicationFacts?.planningDetailsNotApplied).toBe(true);
    expect(second.result?.responseSource).toBe('ai');
    expect(second.result?.message).toContain(GOOD);
    expect(count(second.result?.message ?? '', WEEKLY_PLANNING_DETAILS_NOT_APPLIED_TEXT)).toBe(1);
    expect(second.result?.message).not.toContain(WEEKLY_PLANNING_NOTHING_READ_TEXT);
  });
  it('a pure consultation with no planning content: no sentence', async () => {
    install(GOOD);
    const conversation = open();
    await conversation.submit(T1);
    const second = await conversation.submit(T2_PURE);
    expect(second.result?.communicationFacts?.planningDetailsNotApplied).toBe(false);
    expect(second.result?.message ?? '').not.toContain('反映できていません');
  });
  it('the emergency (fallback) path states it once too', async () => {
    install(null);
    const conversation = open();
    await conversation.submit(T1);
    const second = await conversation.submit(T2);
    expect(second.result?.responseSource).not.toBe('ai');
    expect(count(second.result?.message ?? '', WEEKLY_PLANNING_DETAILS_NOT_APPLIED_TEXT)).toBe(1);
  });
});

describe('weeklyPlanningDetailsNotAppliedNotice', () => {
  it('is the typed fact only, and never stacks with the nothing-read sentence', () => {
    expect(weeklyPlanningDetailsNotAppliedNotice({ planningDetailsNotApplied: true })).toBe(WEEKLY_PLANNING_DETAILS_NOT_APPLIED_TEXT);
    expect(weeklyPlanningDetailsNotAppliedNotice({ planningDetailsNotApplied: false })).toBeNull();
    expect(weeklyPlanningDetailsNotAppliedNotice(null)).toBeNull();
    expect(weeklyPlanningDetailsNotAppliedNotice({ planningDetailsNotApplied: true, nothingRead: true })).toBeNull();
    expect(weeklyPlanningDetailsNotAppliedNotice({ planningDetailsNotApplied: true, uncertaintyReleased: { nothingRead: true } })).toBeNull();
  });
});
