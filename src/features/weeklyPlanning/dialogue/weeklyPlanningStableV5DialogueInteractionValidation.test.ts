import { describe, expect, it } from 'vitest';
import type {
  WeeklyPlanningStableV5CommunicationContext,
  WeeklyPlanningStableV5DialogueRenderInput,
} from './weeklyPlanningStableV5DialogueContracts';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';

/*
 * Interaction-architecture checks on the renderer's OWN output (never on the user's words):
 * an application-owned preview disclosure must be stated, and the reply must not talk about
 * the app's internals. Legacy inputs (no communication context) keep the pre-#488 checks.
 */

function communication(overrides: Partial<WeeklyPlanningStableV5CommunicationContext> = {}): WeeklyPlanningStableV5CommunicationContext {
  return {
    goal: 'explain_question',
    questionPurposes: ['estimate_time_to_fit_available_time'],
    askQuestion: true,
    laterNeeds: [],
    statusReason: null,
    planningDetailsNotApplied: false,
    consultationDeferred: false,
    previewDisclosure: null,
    ...overrides,
  };
}

function input(overrides: Partial<WeeklyPlanningStableV5DialogueRenderInput> = {}): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-1:missing_effort_estimate',
    currentUserMessage: 'なんで時間が必要なの？',
    recentConversation: [{ role: 'user', content: '来週、数学の問題集を20問進めたい' }],
    planningInformation: { tasks: [{ title: '数学の問題集', category: 'study' }] },
    actionKind: 'question',
    questionCode: 'missing_effort_estimate',
    requiredLabels: ['数学の問題集'],
    fallbackText: '数学の問題集は1問あたりどれくらい時間がかかりますか？',
    previewCount: 0,
    conversationArchitecture: 'interaction_v1',
    communication: communication(),
    ...overrides,
  };
}

function render(renderInput: WeeklyPlanningStableV5DialogueRenderInput, text: string) {
  return parseWeeklyPlanningStableV5DialogueRendererResponse(JSON.stringify({
    actionId: renderInput.actionId,
    actionKind: renderInput.actionKind,
    questionCode: renderInput.questionCode,
    groundingAcknowledgement: null,
    text,
  }), renderInput);
}

describe('interaction renderer output: internal vocabulary', () => {
  it('accepts a natural explanation that answers the question first', () => {
    expect(render(input(), '1問にかかる時間が分かると、来週の空き時間に無理なく振り分けられるからです。1問あたり何分くらいですか？'))
      .toMatchObject({ status: 'rendered' });
  });

  it.each([
    '安全に整理できなかったため予定条件には反映していません。1問あたり何分ですか？',
    '内容を構造化できませんでした。1問あたり何分ですか？',
    'validation に失敗しました。1問あたり何分ですか？',
    'pending の質問は変わりません。1問あたり何分ですか？',
    '確認中の質問は変わりません。1問あたり何分ですか？',
    'プロバイダへの接続を再試行しました。1問あたり何分ですか？',
  ])('rejects a reply that talks about the app internals: %s', (text) => {
    expect(render(input(), text)).toMatchObject({ status: 'fallback', reason: 'internal_process_text' });
  });

  it('allows a word the user or the plan data itself uses', () => {
    const renderInput = input({
      currentUserMessage: 'State machine の課題も入れたい',
      planningInformation: { tasks: [{ title: 'Schema 設計の課題', category: 'study' }] },
      requiredLabels: ['Schema 設計の課題'],
    });
    expect(render(renderInput, 'State machine と Schema 設計の課題ですね。1問あたり何分くらいですか？'))
      .toMatchObject({ status: 'rendered' });
  });

  it('does not let an earlier assistant message legitimise internal wording', () => {
    const renderInput = input({
      recentConversation: [{ role: 'assistant', content: 'こちらの処理で予定条件には反映していません。' }],
    });
    expect(render(renderInput, '予定条件には反映していません。1問あたり何分ですか？'))
      .toMatchObject({ status: 'fallback', reason: 'internal_process_text' });
  });

  it('keeps legacy inputs on the pre-#488 checks', () => {
    const legacy = input({ conversationArchitecture: 'legacy_v5', communication: undefined });
    expect(render(legacy, '予定条件には反映していません。1問あたり何分ですか？')).toMatchObject({ status: 'rendered' });
  });
});

describe('interaction renderer output: preview disclosure', () => {
  const preview = (omittedWorkLabels: string[]) => input({
    actionId: 'stable-v5:request-1:preview_ready',
    actionKind: 'preview_ready',
    questionCode: null,
    previewCount: 2,
    previewPromotionControlLabel: 'この内容で仮予定にする',
    requiredLabels: ['この内容で仮予定にする'],
    planningInformation: { tasks: [{ title: '数学', category: 'study' }, { title: '英語', category: 'study' }] },
    communication: communication({
      goal: 'present_preview', askQuestion: false, questionPurposes: [], previewDisclosure: { omittedWorkLabels },
    }),
  });

  it('accepts a reply that names every omitted work item', () => {
    expect(render(preview(['英語']), '2件の候補を作りました。英語は空き時間に入りきらず、今回は入れていません。よければ「この内容で仮予定にする」を押してください。'))
      .toMatchObject({ status: 'rendered' });
  });

  it('falls back when an omitted work item is not mentioned', () => {
    expect(render(preview(['英語']), '2件の候補を作りました。よければ「この内容で仮予定にする」を押してください。'))
      .toMatchObject({ status: 'fallback', reason: 'action_contract_mismatch' });
  });

  it('falls back when the disclosure cannot be verified (no label)', () => {
    expect(render(preview([]), '2件の候補を作りました。一部は入れていません。よければ「この内容で仮予定にする」を押してください。'))
      .toMatchObject({ status: 'fallback', reason: 'action_contract_mismatch' });
  });
});
