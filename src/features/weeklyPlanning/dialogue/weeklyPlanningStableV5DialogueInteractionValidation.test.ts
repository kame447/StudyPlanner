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

describe('interaction renderer output: the question that must be asked', () => {
  it('rejects a reply without any question when the question must be asked (it would be bound as presented)', () => {
    expect(render(input(), '空き時間に収めるためです。'))
      .toMatchObject({ status: 'fallback', reason: 'missing_question' });
    expect(render(input(), '空き時間に収めるためです。1問あたり何分くらいですか？'))
      .toMatchObject({ status: 'rendered' });
  });

  it('does not require a question when none is asked (aside, status)', () => {
    const aside = input({
      actionId: 'stable-v5:request-1:status',
      actionKind: 'status',
      questionCode: null,
      communication: communication({ goal: 'acknowledge_aside', askQuestion: false, questionPurposes: [] }),
    });
    expect(render(aside, 'いいですよ、数学の話をしましょう。')).toMatchObject({ status: 'rendered' });
  });
});

describe('interaction renderer output: no claimed candidates without a new preview', () => {
  const unchangedStatus = () => input({
    actionId: 'stable-v5:request-1:status',
    actionKind: 'status',
    questionCode: null,
    previewPromotionControlLabel: 'この内容で仮予定にする',
    requiredLabels: ['この内容で仮予定にする'],
    communication: communication({
      goal: 'report_status', askQuestion: false, questionPurposes: [], statusReason: 'preview_unchanged',
    }),
  });

  it('rejects the measured false claim on an unchanged preview (real E2E, scenario D)', () => {
    expect(render(unchangedStatus(), '1回1時間くらいですね。2回とも夜に分ける候補が2件できました。よければ「この内容で仮予定にする」を押してください。'))
      .toMatchObject({ status: 'fallback', reason: 'preview_claim_without_preview' });
  });

  it.each(['どちらも夜に分けました。', '希望どおりに調整しました。'])('rejects a placement claim without naming a candidate: %s', (text) => {
    expect(render(unchangedStatus(), text)).toMatchObject({ status: 'fallback', reason: 'preview_claim_without_preview' });
    const legacy = input({ ...unchangedStatus(), conversationArchitecture: 'legacy_v5', communication: undefined });
    expect(render(legacy, text)).not.toMatchObject({ reason: 'preview_claim_without_preview' });
  });

  it('accepts naming the existing preview as unchanged', () => {
    expect(render(unchangedStatus(), '今の2件の候補はそのままです。直したいところがあれば教えてください。よければ「この内容で仮予定にする」を押してください。'))
      .toMatchObject({ status: 'rendered' });
  });

  it.each([
    '今の仮予定の候補はそのままです。何日までに終わらせたいですか？',
    '仮予定は変わりません。何日までに終わらせたいですか？',
    '候補は変更していません。何日までに終わらせたいですか？',
  ])('requires a machine-owned unchanged-preview status for the renderer claim: %s', (text) => {
    expect(render(input(), text)).toMatchObject({ status: 'fallback', reason: 'preview_claim_without_preview' });
    const recovery = input({
      actionKind: 'status', questionCode: null,
      communication: communication({ goal: 'clarify_turn', askQuestion: false, questionPurposes: [] }),
    });
    expect(render(recovery, text)).toMatchObject({ status: 'fallback', reason: 'preview_claim_without_preview' });
    expect(render(input({ conversationArchitecture: 'legacy_v5', communication: undefined }), text))
      .not.toMatchObject({ reason: 'preview_claim_without_preview' });
  });

  it('keeps legacy inputs out of this interaction check', () => {
    const legacy = input({ ...unchangedStatus(), conversationArchitecture: 'legacy_v5', communication: undefined });
    expect(render(legacy, '2回とも夜に分ける候補が2件できました。よければ「この内容で仮予定にする」を押してください。'))
      .not.toMatchObject({ reason: 'preview_claim_without_preview' });
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

describe('interaction renderer output: actual preview constraints', () => {
  it.each(['not_satisfied', 'not_evaluated'] as const)('rejects a new-preview placement claim with %s evidence', (status) => {
    const renderInput = input({
      actionId: 'stable-v5:request-1:preview_ready', actionKind: 'preview_ready', questionCode: null, previewCount: 3,
      previewPromotionControlLabel: 'この内容で仮予定にする', requiredLabels: ['この内容で仮予定にする'],
      communication: communication({
        goal: 'present_preview', askQuestion: false, questionPurposes: [],
        previewConstraintSatisfaction: [{
          sourceFactId: 'night', taskId: 'research', taskLabel: '研究', kind: 'preferred_window', status,
        }],
      }),
    });
    const claim = 'どちらも夜の候補を3件用意しました。「この内容で仮予定にする」を押してください。';
    expect(render(renderInput, claim)).toMatchObject({ status: 'fallback', reason: 'unverified_preview_constraint_claim' });
    expect(render({
      ...renderInput, communication: {
        ...renderInput.communication!,
        previewConstraintSatisfaction: renderInput.communication!.previewConstraintSatisfaction!
          .map(fact => ({ ...fact, status: 'satisfied' })),
      },
    }, claim)).toMatchObject({ status: 'rendered' });
    expect(render({ ...renderInput, conversationArchitecture: 'legacy_v5', communication: undefined }, claim))
      .toMatchObject({ status: 'rendered' });
  });
});


describe('typed consultation feasibility claims', () => {
  it.each(['none', 'fits', 'does_not_fit', 'future_value', undefined])('validates %s against unassessed evidence, without changing legacy', claim => {
    const renderInput = input({
      actionKind: 'status', questionCode: null,
      communication: communication({ goal: 'acknowledge_aside', askQuestion: false, consultation: {
        mode: 'advisory_only', assessmentScope: 'accepted_plan_only',
        feasibility: { status: 'not_evaluated', reason: 'existing_preview_not_rechecked' },
        missingQuestionCodes: [], workEstimates: [], dailyLimits: [], nextAction: 'offer_preference_change',
      } }),
    });
    const raw = JSON.stringify({ actionId: renderInput.actionId, actionKind: 'status', questionCode: null,
      groundingAcknowledgement: null, feasibilityClaim: claim, text: '土日にまとめる形で候補を試してみましょう。' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(raw, renderInput)).toMatchObject(claim === 'none'
      ? { status: 'rendered' } : { status: 'fallback', reason: 'unchecked_consultation_feasibility' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(raw, {
      ...renderInput, conversationArchitecture: 'legacy_v5', communication: undefined,
    })).toMatchObject({ status: 'rendered' });
    for (const status of ['fits', 'does_not_fit'] as const) {
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(raw, {
        ...renderInput, communication: { ...renderInput.communication!, consultation: {
          ...renderInput.communication!.consultation!, feasibility: { status, basis: 'current_turn_scheduler' },
        } },
      })).toMatchObject(claim === 'none' || claim === status ? { status: 'rendered' }
        : { status: 'fallback', reason: 'unchecked_consultation_feasibility' });
    }
  });
});

describe('an unusable turn may not invite promoting the previous preview (review of fa6347e6)', () => {
  const recovery = () => input({
    actionId: 'stable-v5:request-2:status', actionKind: 'status', questionCode: null, requiredLabels: [],
    currentUserMessage: 'やっぱり10ページにして', previewCount: 0,
    communication: communication({ goal: 'clarify_turn', askQuestion: false, questionPurposes: [] }),
  });
  it('sends a reply that offers the promotion control for an unusable message to one repair, then the fallback', () => {
    const text = 'アルゴリズムイントロダクションの候補を確認し「この内容で仮予定にする」を選んでください。';
    expect(render(recovery(), text)).toMatchObject({ status: 'fallback', reason: 'preview_claim_without_preview' });
    expect(render(recovery(), 'うまく受け取れませんでした。伝えたいことを少しずつ分けて教えてください。'))
      .toMatchObject({ status: 'rendered' });
  });
  it('keeps the control in a reply for an unchanged preview and in the historical comparison', () => {
    const text = '今の仮予定の候補はそのままです。直したい点があれば伝えるか、「この内容で仮予定にする」から進めてください。';
    const unchanged = input({
      actionId: 'stable-v5:request-2:status', actionKind: 'status', questionCode: null, requiredLabels: ['この内容で仮予定にする'],
      previewPromotionControlLabel: 'この内容で仮予定にする',
      communication: communication({ goal: 'report_status', askQuestion: false, questionPurposes: [], statusReason: 'preview_unchanged' }),
    });
    expect(render(unchanged, text)).toMatchObject({ status: 'rendered' });
    expect(render({ ...recovery(), conversationArchitecture: 'legacy_v5', communication: undefined }, text))
      .not.toMatchObject({ reason: 'preview_claim_without_preview' });
  });
});
