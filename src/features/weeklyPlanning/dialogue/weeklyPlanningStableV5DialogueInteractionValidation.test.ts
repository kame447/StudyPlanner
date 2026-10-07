import { describe, expect, it } from 'vitest';
import type {
  WeeklyPlanningStableV5CommunicationContext,
  WeeklyPlanningStableV5DialogueRenderInput,
} from './weeklyPlanningStableV5DialogueContracts';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningStableV5DialogueProjection } from '../semantic/weeklyPlanningStableV5DialogueProjection';

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
    // Reviewer counterexamples that the first list let through.
    'いまの内容は予定には反映していません。1問あたり何分ですか？',
    '安全に配置できませんでした。1問あたり何分ですか？',
    '質問は保留にしています。1問あたり何分ですか？',
    'データを検証できませんでした。1問あたり何分ですか？',
    '入力をパースできず、フォールバックしました。1問あたり何分ですか？',
    'さっきの内容は取り込めていません。1問あたり何分ですか？',
    'semantic_uncertainty のため確認します。1問あたり何分ですか？',
    'stable_v5_normalization_rejected でした。1問あたり何分ですか？',
    'missing_effort_estimate を確認します。1問あたり何分ですか？',
  ])('rejects a reply that talks about the app internals: %s', (text) => {
    expect(render(input(), text)).toMatchObject({ status: 'fallback', reason: 'internal_process_text' });
  });

  it('does not let machine keys or enum values of the real planning data legitimise a word', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    const renderInput = input({
      planningInformation: createWeeklyPlanningStableV5DialogueProjection(graph),
      requiredLabels: [],
    });
    expect(JSON.stringify(renderInput.planningInformation)).toContain('revision');
    expect(render(renderInput, 'revision を確認しました。1問あたり何分ですか？'))
      .toMatchObject({ status: 'fallback', reason: 'internal_process_text' });
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
  const preview = (omittedWork: Array<{ label: string; extent: 'all' | 'part' }>) => input({
    actionId: 'stable-v5:request-1:preview_ready',
    actionKind: 'preview_ready',
    questionCode: null,
    previewCount: 2,
    previewPromotionControlLabel: 'この内容で仮予定にする',
    requiredLabels: ['この内容で仮予定にする'],
    planningInformation: { tasks: [{ title: '数学', category: 'study' }, { title: '英語', category: 'study' }] },
    communication: communication({
      goal: 'present_preview', askQuestion: false, questionPurposes: [], previewDisclosure: { omittedWork },
    }),
  });

  // The application states omitted work itself next to the reply; the reply must leave it out.
  it('accepts a reply that leaves the omitted work to the application', () => {
    expect(render(preview([{ label: '英語', extent: 'all' }]), '数学を中心に2件の候補を作りました。よければ「この内容で仮予定にする」を押してください。'))
      .toMatchObject({ status: 'rendered' });
  });

  it.each([
    // A reviewer counterexample: a false claim that the omitted work is included.
    '英語も含めた2件の候補です。よければ「この内容で仮予定にする」を押してください。',
    '英語は今回は入っていません。2件の候補です。よければ「この内容で仮予定にする」を押してください。',
  ])('falls back whenever the reply itself talks about fully omitted work: %s', (text) => {
    expect(render(preview([{ label: '英語', extent: 'all' }]), text))
      .toMatchObject({ status: 'fallback', reason: 'action_contract_mismatch' });
  });

  it('lets the reply name work that is only partly left out, and another task containing the label', () => {
    expect(render(preview([{ label: '英語', extent: 'part' }]), '英語と数学で2件の候補を作りました。よければ「この内容で仮予定にする」を押してください。'))
      .toMatchObject({ status: 'rendered' });
    const withLongerTask = input({
      ...preview([{ label: '英語', extent: 'all' }]),
      planningInformation: { tasks: [{ title: '英語', category: 'study' }, { title: '英語の長文', category: 'study' }] },
    });
    expect(render(withLongerTask, '英語の長文で2件の候補を作りました。よければ「この内容で仮予定にする」を押してください。'))
      .toMatchObject({ status: 'rendered' });
  });
});
