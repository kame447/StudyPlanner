import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';

const control = 'この内容で仮予定にする';
function input(overrides: Partial<WeeklyPlanningStableV5DialogueRenderInput> = {}): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'preview-synthetic', conversationArchitecture: 'interaction_v1', actionKind: 'preview_ready', questionCode: null,
    currentUserMessage: '1ページ3分くらい', recentConversation: [], planningInformation: { tasks: [{ title: '教材A' }] },
    requiredLabels: ['教材A'], previewCount: 1, previewPromotionControlLabel: control, fallbackText: `内容を確認して「${control}」を押してください。`,
    communication: { goal: 'present_preview', questionPurposes: [], askQuestion: false, laterNeeds: [], statusReason: null,
      planningDetailsNotApplied: false, consultationDeferred: false, previewDisclosure: null },
    currentTurnGrounding: { mode: 'recommended', acceptedFacts: [{ factId: 'rate-synthetic', kind: 'effort_estimate',
      sourceText: '1ページ3分くらい', data: { kind: 'duration_per_unit', minutes: 3, unit: 'page' } }] },
    ...overrides,
  };
}
function render(text: string, original = input()) {
  return parseWeeklyPlanningStableV5DialogueRendererResponse(JSON.stringify({ actionId: original.actionId,
    actionKind: original.actionKind, questionCode: original.questionCode, groundingAcknowledgement: null,
    text: `${text}「${control}」を押してください。` }), original);
}

describe('evidenced candidate creation is separate from application mutations', () => {
  it.each(['候補1件を作成しました。', '候補を1件作成しました。', '候補を作成しました。'])('accepts evidenced candidate creation, including the live D form: %s', text => {
    expect(render(`1ページ3分くらいですね。${text}`)).toMatchObject({ status: 'rendered' });
  });
  it.each([
    '候補1件を作成しました。予定を保存しました。',
    '候補1件を作成しました。予定を作成しました。',
    '候補1件を作成しました。承認しました。',
    '候補1件を作成しました。予定を登録しました。',
    '候補を保存して作成しました。',
    '候補として予定を作成しました。',
    '候補1件を作成しました、予定を保存しました。',
    '候補1件を作成しましたが、予定を作成しました。',
    '予定として候補1件を作成しました。',
  ])('still rejects an unevidenced mutation: %s', text => {
    expect(render(text)).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
  it('rejects an invented count and an empty preview', () => {
    expect(render('候補2件を作成しました。')).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    expect(render('候補1件を作成しました。', input({ previewCount: 0 }))).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
  it('rejects creation when this turn did not produce a preview', () => {
    expect(render('候補1件を作成しました。', input({ actionKind: 'status', previewCount: 0 })))
      .toMatchObject({ status: 'fallback', reason: 'preview_claim_without_preview' });
  });
  it('preserves the legacy creation guard byte-for-byte', () => {
    expect(render('候補1件を作成しました。', input({ conversationArchitecture: 'legacy_v5', communication: undefined })))
      .toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
});


it.each([false, true])('replays D through the controller without saving work (extra mutation=%s)', async extraMutation => {
  const { conditionSetupDocument } = await import('../testUtils/weeklyPlanningConditionPropagationFixture');
  const { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply } = await import('../testUtils/weeklyPlanningScriptedConversationHarness');
  resetScriptedConversationRuntime();
  const setup: Record<string, unknown> = conditionSetupDocument();
  setup.tasks = (setup.tasks as unknown[]).slice(0, 1);
  const syntheticSetup = JSON.stringify(setup).split('アルゴリズムイントロダクション').join('教材A');
  const provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') {
      const decision = call.payload?.applicationDecision as Record<string, unknown>;
      return scriptedRendererReply(call, decision.actionKind === 'preview_ready'
        ? `1ページ3分くらいですね。候補1件を作成しました。${extraMutation ? '予定を保存しました。' : ''}「${control}」を押してください。`
        : '教材Aは1ページあたり何分くらいですか？');
    }
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit', minutes: 3, precision: 'approximate', quantityRole: null });
    return syntheticSetup;
  });
  try {
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    const first = await conversation.submit('来週、教材Aを20ページ読む');
    expect(first.result?.failure, JSON.stringify(first.debugTrace)).toBeUndefined();
    const workloads = structuredClone(conversation.graph()!.workloads);
    const turn = await conversation.submit('1ページ3分くらい');
    expect(turn.result?.failure).toBeUndefined();
    // An unevidenced mutation is regenerated once (the shared repair slot), is still ungrounded, and ends in the fallback.
    expect(turn.calls.filter(call => call.kind === 'renderer')).toHaveLength(extraMutation ? 2 : 1);
    expect(turn.result?.dialogueRendererTrace?.response).toMatchObject(extraMutation
      ? { status: 'fallback', reason: 'ungrounded_text' } : { status: 'rendered', reason: null });
    if (!extraMutation) expect(turn.result?.responseSource).toBe('ai');
    expect(conversation.graph()!.workloads).toEqual(workloads);
    expect(conversation.getState().previewCandidates).toHaveLength(1);
    expect(conversation.getState().draftBlocks).toEqual([]);
    expect(conversation.getState().pendingApproval).toBeUndefined();
  } finally { provider.restore(); resetScriptedConversationRuntime(); }
}, 30_000);
