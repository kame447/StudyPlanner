import { afterEach, describe, expect, it } from 'vitest';
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import {
  createScriptedConversation, resetScriptedConversationRuntime, scriptedRendererReply,
  type ScriptedProviderCall, type ScriptedProviderReply,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import {
  BULK, DECLINE, OVERLOAD, examBusyPlans, installExamOverloadProvider, acceptingReplyVerifierReply,
} from './testUtils/weeklyPlanningExamOverloadFixture';
import { WEEKLY_PLANNING_VERIFIED_DIALOGUE_TECHNICAL_STOP_TEXT } from './dialogue/weeklyPlanningTechnicalStop';

/*
 * Issue #488 P2 slice 1: the capacity shortfall is conveyed by the AI-written reply and VERIFIED against the typed
 * mustConvey fact (the fixed appender is retired). Fault injection: the scripted renderer omits or contradicts the fact,
 * the scripted verifier is malformed or unavailable. Every one ends in a regeneration or a technical stop, never a pass.
 */
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installExamOverloadProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const ASK = 'いくつかの作業が今の期間に入りきりませんでした。期間を延ばすか、量を減らすか、使える時間を増やせるか、どれがよいですか？';
const mustConveyOf = (call: ScriptedProviderCall) => (((call.payload?.applicationDecision as Json)?.communication as Json)?.mustConvey as Json[] | undefined)?.[0] as
  { requiredMinutes: number; moreCount: number; unmet: Array<{ label: string; minutes: number }> } | undefined;
/** An honest reply: it states the typed figures and labels exactly as given. */
function faithfulText(call: ScriptedProviderCall): string {
  const fact = mustConveyOf(call)!;
  return `${ASK}入りきらなかった作業は${fact.unmet.map(item => `${item.label}（約${item.minutes}分）`).join('、')}${fact.moreCount > 0 ? `とほか${fact.moreCount}件` : ''}で、必要な時間は合計${fact.requiredMinutes}分です。`;
}
const OMITTING = 'いくつかの作業が入りきりませんでした。どうしましょうか？';

async function overload(
  renderer: (call: ScriptedProviderCall, rendererIndex: number) => ScriptedProviderReply,
  verifier: (call: ScriptedProviderCall) => ScriptedProviderReply = acceptingReplyVerifierReply,
  beforeTurn?: (conv: ReturnType<typeof createScriptedConversation>) => void,
) {
  let rendererIndex = 0;
  provider = installExamOverloadProvider(30, false, false, (call) => renderer(call, rendererIndex++), verifier);
  const conv = createScriptedConversation({ provider, plans: examBusyPlans, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-09T09:00:00.000Z' });
  await conv.submit(BULK);
  await conv.submit(DECLINE);
  const before = JSON.stringify(conv.getState());
  beforeTurn?.(conv);
  const calls = () => provider.calls.filter(call => call.kind === 'renderer' || call.kind === 'reply_verifier');
  const priorCalls = calls().length;
  const turn = await conv.submit(OVERLOAD);
  return { conv, turn, before, turnCalls: calls().slice(priorCalls) };
}
const workloadsOf = (graph: ReturnType<ReturnType<typeof createScriptedConversation>['graph']>) =>
  (graph?.workloads ?? []).map(w => `${w.id}:${(w as unknown as Json).amount}`).sort();
const isCapacity = (call: ScriptedProviderCall) => mustConveyOf(call) !== undefined;
const render = (call: ScriptedProviderCall, text: string) => scriptedRendererReply(call, text);

describe('P2 slice 1: the shortfall is verified, not appended', () => {
  it('RED/GREEN: a faithful reply passes with no fixed appender, writer + one verifier call', async () => {
    const { turn, turnCalls } = await overload((call) => render(call, isCapacity(call) ? faithfulText(call) : 'わかりました。'));
    expect(turn.result?.responseSource).toBe('ai');
    expect(turn.result?.message).toMatch(/合計\d+分/);
    expect(turn.result?.message).not.toMatch(/\n\n入りきらなかった作業: /);
    expect(turnCalls.map(call => call.kind)).toEqual(['renderer', 'reply_verifier']);
  });

  it('RED: a reply that omits the figures is never shown; it is regenerated once and the faithful rewrite passes', async () => {
    let calls = 0;
    const { turn, turnCalls } = await overload((call) => render(call, isCapacity(call) && calls++ > 0 ? faithfulText(call) : OMITTING));
    expect(turn.result?.message).toMatch(/合計\d+分/);
    expect(turn.result?.message).not.toBe(OMITTING);
    // writer, (literal check fails before any verifier call), rewrite, verifier
    expect(turnCalls.map(call => call.kind)).toEqual(['renderer', 'renderer', 'reply_verifier']);
  });

  it('omit twice → technical stop: controlled failure, state unchanged, no claim', async () => {
    let graphBefore: { revision: number; workloads: unknown } = { revision: -1, workloads: null };
    const { conv, turn, turnCalls } = await overload((call) => render(call, OMITTING), acceptingReplyVerifierReply, (c) => { graphBefore = { revision: c.graph()?.revision ?? -1, workloads: workloadsOf(c.graph()) }; });
    expect(turn.result?.failure?.code).toBe('stable_v5_dialogue_verification_failed');
    expect(turn.result?.message).toBe(WEEKLY_PLANNING_VERIFIED_DIALOGUE_TECHNICAL_STOP_TEXT);
    expect(turn.result?.responseSource).toBe('system');
    expect(turnCalls.filter(call => call.kind === 'renderer').length).toBe(2);
    expect(graphBefore.revision).toBeGreaterThan(0);
    expect((graphBefore.workloads as unknown[]).length).toBeGreaterThan(0);
    expect(conv.graph()?.revision).toBe(graphBefore.revision);
    expect(workloadsOf(conv.graph())).toEqual(graphBefore.workloads);
    expect(conv.getState().pendingTurn).toBeFalsy();
  });

  it('contradict (right numbers, verifier says contradicted) → regenerate once → stop', async () => {
    const verifier = (call: ScriptedProviderCall) => JSON.stringify({ verdicts: [{ key: 'shortfall', verdict: 'contradicted' }], forbidden: ['plan_fits'], _: call.index });
    const { turn, turnCalls } = await overload((call) => render(call, isCapacity(call) ? faithfulText(call) : 'ok'), verifier);
    expect(turn.result?.failure?.code).toBe('stable_v5_dialogue_verification_failed');
    expect(turnCalls.map(call => call.kind)).toEqual(['renderer', 'reply_verifier', 'renderer', 'reply_verifier']);
  });

  it('accurate verdicts but a forbidden claim (twice) → regenerate once → stop, graph unchanged', async () => {
    const verifier = () => JSON.stringify({ verdicts: [{ key: 'shortfall', verdict: 'stated_accurately' }], forbidden: ['saved'] });
    let graphBefore: { revision: number; workloads: unknown } = { revision: -1, workloads: null };
    const { conv, turn, turnCalls } = await overload((call) => render(call, isCapacity(call) ? faithfulText(call) : 'ok'), verifier,
      (c) => { graphBefore = { revision: c.graph()?.revision ?? -1, workloads: workloadsOf(c.graph()) }; });
    expect(turn.result?.failure?.code).toBe('stable_v5_dialogue_verification_failed');
    expect(turnCalls.map(call => call.kind)).toEqual(['renderer', 'reply_verifier', 'renderer', 'reply_verifier']);
    expect(graphBefore.revision).toBeGreaterThan(0);
    expect(conv.graph()?.revision).toBe(graphBefore.revision);
    expect(workloadsOf(conv.graph())).toEqual(graphBefore.workloads);
  });

  it.each([
    ['malformed', () => 'not json'],
    ['wrong code set', () => JSON.stringify({ verdicts: [], forbidden: [] })],
    ['unavailable', () => ({ failure: 'network' as const })],
  ])('verifier %s → stop, never a pass', async (_name, verifier) => {
    const { turn, turnCalls } = await overload((call) => render(call, isCapacity(call) ? faithfulText(call) : 'ok'), verifier as never);
    expect(turn.result?.failure?.code).toBe('stable_v5_dialogue_verification_failed');
    expect(turn.result?.message).toBe(WEEKLY_PLANNING_VERIFIED_DIALOGUE_TECHNICAL_STOP_TEXT);
    expect(turnCalls.filter(call => call.kind === 'renderer').length).toBe(1);
  });

  it('the verifier is told what shortfall means and forbids only claims that are false on a shortfall turn', async () => {
    const { turnCalls } = await overload((call) => render(call, isCapacity(call) ? faithfulText(call) + '頂いた変更は取り込んでいます。' : 'ok'));
    const system = turnCalls.find(call => call.kind === 'reply_verifier')!.messages[0].content;
    expect(system).toContain('NOT all of the work fits');
    expect(system).toContain('plan_fits');
    expect(system).not.toContain('applied');
    const schema = JSON.stringify(turnCalls.find(call => call.kind === 'reply_verifier')!.request);
    expect(schema).not.toContain('"applied"');
  });

  it('after a stop the turn-start question stays bound: same target, same presentation, same graph revision', async () => {
    let omit = false;
    const { conv } = await overload((call) => render(call, isCapacity(call) && !omit ? faithfulText(call) : OMITTING));
    const start = JSON.parse(JSON.stringify(conv.getState().intakeState?.lastQuestionContext));
    expect(start?.presentation, 'the capacity question of the first turn is bound').toBeTruthy();
    omit = true;
    const stopped = await conv.submit(OVERLOAD);
    expect(stopped.result?.failure?.code).toBe('stable_v5_dialogue_verification_failed');
    const kept = conv.getState().intakeState?.lastQuestionContext as { targetSlot?: string; presentation?: { graphRevision: number; content: unknown; assistantMessageId: string } } | undefined;
    expect(kept?.targetSlot).toBe(start.targetSlot);
    expect(kept?.presentation?.graphRevision).toBe(start.presentation.graphRevision);
    expect(kept?.presentation?.content).toEqual(start.presentation.content);
    expect(kept?.presentation?.assistantMessageId).not.toBe(start.presentation.assistantMessageId);
  });

  it('after a stop the NEXT turn\'s semantic pendingQuestion equals the pre-stop one (same code, target and graph revision)', async () => {
    let omit = false;
    const { conv } = await overload((call) => render(call, isCapacity(call) && !omit ? faithfulText(call) : OMITTING));
    const pendingOf = (turn: { calls: ScriptedProviderCall[] }) => {
      const semantic = turn.calls.find(call => call.kind === 'semantic_generic')!;
      return (semantic.payload?.publicStateSummary as Json | undefined)?.pendingQuestion ?? null;
    };
    omit = true;
    const stopped = await conv.submit(OVERLOAD);
    expect(stopped.result?.failure?.code).toBe('stable_v5_dialogue_verification_failed');
    const preStop = pendingOf(stopped);
    expect(preStop, 'the question the user still sees').toMatchObject({ questionCode: 'insufficient_capacity' });
    omit = false;
    const next = await conv.submit(OVERLOAD);
    expect(pendingOf(next)).toEqual(preStop);
  });

  it('a resend after the stop applies once (same state as a clean turn)', async () => {
    let failFirst = true;
    const { conv, turn } = await overload((call) => {
      if (!isCapacity(call)) return render(call, 'ok');
      if (failFirst) return render(call, OMITTING);
      return render(call, faithfulText(call));
    });
    expect(turn.result?.failure).toBeTruthy();
    failFirst = false;
    const again = await conv.submit(OVERLOAD);
    expect(again.result?.failure).toBeUndefined();
    expect(again.result?.message).toMatch(/合計\d+分/);
    const clean = await overload((call) => render(call, isCapacity(call) ? faithfulText(call) : 'ok'));
    expect(workloadsOf(conv.graph())).toEqual(workloadsOf(clean.conv.graph()));
  });

  it('legacy_v5 is unchanged: no mustConvey, no verifier call', async () => {
    provider = installExamOverloadProvider(30);
    const conv = createScriptedConversation({ provider, plans: examBusyPlans, architecture: 'legacy_v5', weekStartDate: '2026-10-12', now: () => '2026-10-09T09:00:00.000Z' });
    await conv.submit(BULK); await conv.submit(DECLINE);
    const turn = await conv.submit(OVERLOAD);
    expect(provider.calls.some(call => call.kind === 'reply_verifier')).toBe(false);
    expect(turn.result?.message ?? '').not.toMatch(/mustConvey/);
    expect(JSON.stringify(provider.calls.map(call => call.messages))).not.toContain('mustConvey');
  });
});
