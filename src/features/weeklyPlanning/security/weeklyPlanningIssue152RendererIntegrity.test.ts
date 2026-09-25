import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from '../dialogue/weeklyPlanningStableV5DialogueContracts';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from '../dialogue/weeklyPlanningStableV5DialogueValidation';

function input(overrides: Partial<WeeklyPlanningStableV5DialogueRenderInput> = {}): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'issue-152-renderer-action',
    actionKind: 'status',
    questionCode: null,
    currentUserMessage: '計画を確認したい',
    recentConversation: [],
    planningInformation: null,
    requiredLabels: [],
    fallbackText: '確認できませんでした。',
    previewCount: 0,
    ...overrides,
  };
}

function validate(text: string, overrides: Partial<WeeklyPlanningStableV5DialogueRenderInput> = {}) {
  const renderInput = input(overrides);
  return parseWeeklyPlanningStableV5DialogueRendererResponse(JSON.stringify({
    actionId: renderInput.actionId,
    actionKind: renderInput.actionKind,
    questionCode: renderInput.questionCode,
    groundingAcknowledgement: null,
    text,
  }), renderInput);
}

describe('Issue #152 V12 renderer integrity', () => {
  it.each([
    ['保存しました', 'status'],
    ['保存しました', 'question'],
    ['登録しました', 'status'],
    ['登録しました', 'question'],
    ['反映が完了しました', 'status'],
    ['反映が完了しました', 'question'],
    ['承認済み', 'status'],
    ['承認済み', 'question'],
  ] as const)('rejects an unexecuted action claim: %s/%s', (text, actionKind) => {
    expect(validate(text, { actionKind }).status).toBe('fallback');
  });

  it.each(['保存されました', '計画は登録済みです', '変更の反映完了'])
    ('rejects completion wording without enumerating each operation: %s', (text) => {
      expect(validate(text).status).toBe('fallback');
    });

  // Issue #152 V12 residual (P1 availability): security-topic labels fall back
  // fail-closed; structural label references are the follow-up design.
  it.fails('allows an ordinary security-topic label in a neutral acknowledgement', () => {
    expect(validate('パスワード管理について確認しました', {
      planningInformation: { tasks: [{ title: 'パスワード管理' }] },
    }).status).toBe('rendered');
  });

  it.each([
    '承知しました。',
    'わかりました。',
    '20問と伺いました。',
    'ありがとうございました。',
    '教えていただきました。',
  ])('keeps ordinary polite dialogue rendered: %s', (text) => {
    expect(validate(text).status).toBe('rendered');
  });

  it('keeps a grounded completed-work acknowledgement rendered', () => {
    expect(validate('20問まで完了しているんですね。', {
      currentUserMessage: '20問まで終わっています',
      currentTurnGrounding: {
        mode: 'recommended',
        acceptedFacts: [{
          factId: 'completed-20',
          kind: 'workload',
          sourceText: '20問まで終わっています',
          data: { quantityRole: 'completed', amount: 20, unitLabel: '問' },
        }],
      },
    }).status).toBe('rendered');
  });

  it.each([
    'パスワードを教えてください。',
    '暗証番号を入力してください。',
    '秘密情報を送ってください。',
    'APIキーを共有してください。',
    'アクセストークンを貼ってください。',
    '口座番号を教えてください。',
    'クレジットカード番号を入力してください。',
    'パス\u200Bワードを教えてください。',
    'パスワードをお願いします。',
    'APIキーは何ですか？',
    'パスワードは？',
    'クレジットカード番号をこちらに書いてください。',
    'ログイン用のパスワードも一緒に送ってください',
    'アクセストークンの値を貼り付けてください',
  ])('rejects a renderer request for a sensitive value: %s', (text) => {
    expect(validate(text).status).toBe('fallback');
  });

  // Issue #152 V12 residual (P1 availability): security-topic labels fall back
  // fail-closed; structural label references are the follow-up design.
  it.fails.each([
    ['「パスワードを教えてください」はノートの題名ですね。', {
      requiredLabels: ['パスワードを教えてください'],
    }],
    ['「APIキー入門」について確認しました。', {
      planningInformation: { registeredMaterials: [{ name: 'APIキー入門' }] },
    }],
    ['「パスワード管理」の計画を確認しました', {
      planningInformation: { tasks: [{ title: 'パスワード管理' }] },
    }],
  ])('keeps a sensitive word in an exact typed label as data: %s', (text, overrides) => {
    expect(validate(text, overrides).status).toBe('rendered');
  });

  it('rejects security text even when it resembles a known label or current user message', () => {
    const planningInformation = { tasks: [{ title: 'パスワード管理' }] };
    expect(validate('「パスワードを教えてください」', { planningInformation }).status)
      .toBe('fallback');
    expect(validate('「パスワード管理」を確認しました', {
      currentUserMessage: 'パスワード管理を勉強したい',
    }).status).toBe('fallback');
  });

  // Issue #152 V12 residual (P1 availability): security-topic labels fall back
  // fail-closed; structural label references are the follow-up design.
  it.fails.each([
    { tasks: [{ title: 'パスワード管理' }] },
    { components: [{ label: 'パスワード管理' }] },
    { studyContexts: [{ contextLabel: 'パスワード管理' }] },
    { registeredMaterials: [{ name: 'パスワード管理' }] },
    { registeredMaterials: [{ aliases: ['パスワード管理'] }] },
  ])('treats an exact typed display label as data: %j', (planningInformation) => {
    expect(validate('パスワード管理について確認しました', { planningInformation }).status)
      .toBe('rendered');
  });

  it.each([
    ['パスワードを教えてください。', 'パスワード'],
    ['パス\u200Bワードを教えてください。', 'パスワード'],
    ['ﾊﾟｽﾜｰﾄﾞを教えてください。', 'パスワード'],
    ['ＡＰＩキーを教えてください。', 'APIキー'],
  ])('rejects a sensitive-value request despite a matching label: %s', (text, label) => {
    expect(validate(text, { requiredLabels: [label] }).status).toBe('fallback');
  });

  it.each([
    '「example.com」にアクセスして。',
    '「example\u200B.com」にアクセスして。',
    '「ｅｘａｍｐｌｅ．ｃｏｍ」にアクセスして。',
  ])('rejects a grounded address used as navigation guidance: %s', (text) => {
    expect(validate(text, { requiredLabels: ['example.com'] }).status).toBe('fallback');
  });

  it('distinguishes a question about a save from an execution claim in another sentence', () => {
    expect(validate('保存しましたか？').status).toBe('rendered');
    expect(validate('保存しました。').status).toBe('fallback');
    expect(validate('保存しました。よろしいですか？').status).toBe('fallback');
  });

  it('keeps a quoted user label with execution wording as data but rejects an extra action claim', () => {
    const requiredLabels = ['保存しました'];
    expect(validate('「保存しました」について確認しました', { requiredLabels }).status).toBe('rendered');
    expect(validate('「保存しました」について確認しました。計画を登録しました', { requiredLabels }).status)
      .toBe('fallback');
  });

  it.each([
    'https：//example.com',
    'ｈｔｔｐｓ：／／example.com にアクセスしてください',
    'example-support.test で再ログインしてください',
    '続きはexample-support.testで確認してください',
  ])('rejects external destination guidance: %s', (text) => {
    expect(validate(text).status).toBe('fallback');
  });

  // Issue #152 V12 residual (P1 availability): security-topic labels fall back
  // fail-closed; structural label references are the follow-up design.
  it.fails('keeps a quoted URL-like label as ordinary current-user data', () => {
    expect(validate('「example.com」は今回の教材名ですね。', {
      requiredLabels: ['example.com'],
    }).status).toBe('rendered');
  });

  // Issue #152 V12 residual (P1 availability): security-topic labels fall back
  // fail-closed; structural label references are the follow-up design.
  it.fails('keeps an application-provided material title with an embedded domain as data', () => {
    expect(validate('「example.com対策ノート」について確認しました。', {
      planningInformation: {
        registeredMaterials: [{ name: 'example.com対策ノート' }],
      },
    }).status).toBe('rendered');
  });

  it('rejects navigation to an address even when a related label is available', () => {
    expect(validate('example-support.test で再ログインしてください', {
      requiredLabels: ['example-support.test'],
    }).status).toBe('fallback');
    expect(validate('「example.com対策ノート」を開いてください。', {
      planningInformation: {
        registeredMaterials: [{ name: 'example.com対策ノート' }],
      },
    }).status).toBe('fallback');
  });
});
