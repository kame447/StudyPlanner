import { afterEach, describe, expect, it } from 'vitest';
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { createScriptedConversation, resetScriptedConversationRuntime, scriptedRendererReply, type ScriptedProviderCall } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { BULK, DECLINE, OVERLOAD, examBusyPlans, installExamOverloadProvider } from './testUtils/weeklyPlanningExamOverloadFixture';

/*
 * Issue #488 exam-student RED B3: an overload (+120 problems) ends in `insufficient_capacity`, but the reply
 * writer was handed only a generic question purpose. The application owns the status facts: the typed
 * unmet work (and its amounts) must reach the renderer's applicationDecision.communication, and the
 * application states the figures itself next to the reply.
 */
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installExamOverloadProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

async function overloadTurn(architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') {
  provider = installExamOverloadProvider(30);
  const conv = createScriptedConversation({ provider, plans: examBusyPlans, architecture, weekStartDate: '2026-10-12', now: () => '2026-10-09T09:00:00.000Z' });
  await conv.submit(BULK);
  await conv.submit(DECLINE);
  return { conv, turn: await conv.submit(OVERLOAD) };
}
const decisionOf = (turn: Awaited<ReturnType<typeof overloadTurn>>['turn']) => {
  const renderer = turn.calls.filter(call => call.kind === 'renderer');
  return renderer[renderer.length - 1]?.payload?.applicationDecision as Json;
};

describe('B3: the capacity question carries the unmet work', () => {
  it('precondition: the product asked the capacity question', async () => {
    const { turn } = await overloadTurn();
    expect(decisionOf(turn).questionCode).toBe('insufficient_capacity');
  });
  it('the renderer decision carries typed unmet figures', async () => {
    const { turn } = await overloadTurn();
    const text = JSON.stringify(decisionOf(turn));
    expect(['120', '720', '1808'].some(figure => text.includes(figure)), text.slice(0, 300)).toBe(true);
    const shortfall = (decisionOf(turn).communication as Json).capacityShortfall as Json;
    expect(shortfall).toBeTruthy();
    expect(typeof shortfall.requiredMinutes).toBe('number');
    expect((shortfall.unmetWork as Json[]).length).toBeGreaterThan(0);
  });
  it('legacy_v5 stays without the fact and the sentence', async () => {
    const { turn } = await overloadTurn('legacy_v5');
    expect(turn.result?.message ?? '').not.toMatch(/入りきらなかった作業/);
    expect(turn.result?.communicationFacts).toBeUndefined();
  });
});

describe('B3: the AI-rendered reply', () => {
  const ASK = 'いくつかの作業が今の期間に入りきりませんでした。期間を延ばすか、量を減らすか、使える時間を増やせるか、どれがよいですか？';
  it('the renderer is told to state the figures; a faithful AI reply is shown as AI text with no fixed sentence appended (P2: verified)', async () => {
    const mustConvey = (call: ScriptedProviderCall) => (((call.payload?.applicationDecision as Json)?.communication as Json)?.mustConvey as Json[] | undefined)?.[0] as
      { requiredMinutes: number; moreCount: number; unmet: Array<{ label: string; minutes: number }> } | undefined;
    provider = installExamOverloadProvider(30, false, false, (call) => {
      const fact = mustConvey(call);
      return scriptedRendererReply(call, fact
        ? `${ASK}${fact.unmet.map(item => `${item.label}（約${item.minutes}分）`).join('、')}${fact.moreCount > 0 ? `とほか${fact.moreCount}件` : ''}が入らず、必要な時間は合計${fact.requiredMinutes}分です。`
        : 'わかりました。');
    });
    const conv = createScriptedConversation({ provider, plans: examBusyPlans, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-09T09:00:00.000Z' });
    await conv.submit(BULK);
    await conv.submit(DECLINE);
    const turn = await conv.submit(OVERLOAD);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.responseSource).toBe('ai');
    expect(turn.result?.message.startsWith(ASK)).toBe(true);
    expect(turn.result?.message).toMatch(/合計\d+分です。$/);
    expect(turn.result?.message).not.toMatch(/\n\n入りきらなかった作業: /);
    const renderer = turn.calls.filter(call => call.kind === 'renderer').pop()!;
    expect(JSON.stringify(renderer.messages)).toContain('mustConvey shortfall: In your own words');
  });
  it('the capacity fact exists only on the capacity question', async () => {
    provider = installExamOverloadProvider(30);
    const conv = createScriptedConversation({ provider, plans: examBusyPlans, architecture: 'interaction_v1', weekStartDate: '2026-10-12', now: () => '2026-10-09T09:00:00.000Z' });
    const first = await conv.submit(BULK);
    const renderer = first.calls.filter(call => call.kind === 'renderer').pop();
    expect(JSON.stringify(renderer?.payload ?? {})).not.toContain('capacityShortfall');
  });
});
