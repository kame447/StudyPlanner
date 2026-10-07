import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedConversation, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import {
  CONDITION_SETUP, CONDITION_PACE, CONDITION_FOLLOWUP, conditionSetupDocument, conditionDocument,
} from './testUtils/weeklyPlanningConditionPropagationFixture';
import { liveDSplitSessionDocument } from './testUtils/weeklyPlanningLiveSessionCapFixture';
import { declaration, type Json } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let conversation: ScriptedConversation;
let delta: Json;
let reply: (call: ScriptedProviderCall) => string;

beforeEach(() => {
  resetScriptedConversationRuntime();
  reply = call => scriptedRendererReply(call, '候補を確認してください。');
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return reply(call);
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({
      decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
      minutes: 3, precision: 'approximate', quantityRole: null,
    });
    return JSON.stringify(call.payload?.userText === CONDITION_SETUP ? conditionSetupDocument() : delta);
  });
  conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
});
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); });

async function setup() {
  await conversation.submit(CONDITION_SETUP);
  const pace = await conversation.submit(CONDITION_PACE);
  expect(pace.result?.failure).toBeUndefined();
  expect(conversation.getState().previewCandidates).toHaveLength(2);
}

function ackReply(call: ScriptedProviderCall, ack: string, prefix: boolean) {
  const grounding = call.payload!.currentTurnGrounding as { acceptedFacts: Array<{ factId: string }> };
  return JSON.stringify({
    ...JSON.parse(scriptedRendererReply(call, `${prefix ? ack : ''}候補を確認し「この内容で仮予定にする」を選んでください。`)),
    groundingAcknowledgement: { factIds: grounding.acceptedFacts.map(fact => fact.factId), text: ack },
  });
}

describe('claim repair through real controller turns', () => {
  it.each([false, true])('keeps the exact live D T3 semantic shape AI-rendered with at most one repair (hard morning=%s)', async hardMorning => {
    await setup();
    // Pink owns this sanitized exact live document: BOTH tasks, including the page-unit
    // book, receive session_duration 60, recurrence count 2, and preferred night.
    delta = liveDSplitSessionDocument(conversation.graph()!);
    if (hardMorning) delta.availabilityDeclarations = [declaration({
      kind: 'available', startTime: '09:00', endTime: '12:00', recurrenceKind: 'daily',
      constraintLevel: 'hard', sourceText: '使えるのは毎日9時から12時だけ',
    })];
    let rendererCalls = 0;
    reply = call => ++rendererCalls === 1
      // The actual live D ACK was separate from the preview announcement.
      ? ackReply(call, '1回1時間くらいで2回に分けて、どっちも夜がいいのですね。', false)
      : ackReply(call, 'ご希望を受け取りました。', true);
    const turn = await conversation.submit(CONDITION_FOLLOWUP + (hardMorning ? '。使えるのは毎日9時から12時だけ' : ''));
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.responseSource, JSON.stringify({ trace: turn.result?.dialogueRendererTrace, calls: turn.calls.map(c => ({kind:c.kind, messages:c.messages.length})) })).toBe('ai');
    expect(turn.result?.dialogueRendererTrace?.response.status).toBe('rendered');
    const calls = turn.calls.filter(call => call.kind === 'renderer');
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(conversation.getState().previewCandidates!.length).toBeGreaterThan(0);
    if (hardMorning) {
      expect(calls).toHaveLength(2);
      expect(turn.result?.communicationFacts?.previewConstraintSatisfaction?.some(fact => fact.status === 'not_satisfied')).toBe(true);
      expect(turn.result?.message).not.toContain('どっちも夜がいいのですね');
    }
    expect(turn.calls.filter(call => call.kind.startsWith('semantic'))).toHaveLength(1);
  });

  it('repairs unchecked consultation feasibility while keeping planning state and the preview intact', async () => {
    await setup();
    const beforeGraph = structuredClone(conversation.graph());
    const beforeCandidates = structuredClone(conversation.getState().previewCandidates);
    delta = conditionDocument({ conversationActs: [{ kind: 'consultation_request', targetPublicId: null }] });
    let rendererCalls = 0;
    reply = call => JSON.stringify({
      ...JSON.parse(scriptedRendererReply(call, ++rendererCalls === 1
        ? 'まとめて進める形も可能ですが、空き時間を確かめましょう。'
        : '土日にまとめる形で候補を試してみましょう。空き時間に収まるかは候補で確かめます。')),
      feasibilityClaim: rendererCalls === 1 ? 'fits' : 'none',
    });
    const turn = await conversation.submit('その前に、土日にまとめてやる感じでも大丈夫？');
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.responseSource, JSON.stringify({ trace: turn.result?.dialogueRendererTrace, calls: turn.calls.map(c => ({kind:c.kind, messages:c.messages.length})) })).toBe('ai');
    expect(turn.result?.dialogueRendererTrace?.response.status).toBe('rendered');
    expect(turn.calls.filter(call => call.kind === 'renderer')).toHaveLength(2);
    expect(turn.result?.message).not.toContain('可能');
    // A processed request is recorded for idempotency; accepted facts and revision stay fixed.
    expect({ ...conversation.graph(), appliedTurnKeys: [] }).toEqual({ ...beforeGraph, appliedTurnKeys: [] });
    expect(conversation.graph()!.appliedTurnKeys).toHaveLength(beforeGraph!.appliedTurnKeys.length + 1);
    expect(conversation.getState().previewCandidates).toEqual(beforeCandidates);
    const renderer = turn.calls.find(call => call.kind === 'renderer')!;
    expect(renderer.payload?.applicationDecision).toMatchObject({ communication: { consultation: {
      mode: 'advisory_only', feasibility: { status: 'not_evaluated' },
    } } });
  });
});
