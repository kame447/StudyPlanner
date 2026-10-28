import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';

const QUESTION = 'どれくらい進めたいですか？';

function input(actionKind: WeeklyPlanningStableV5DialogueRenderInput['actionKind'] = 'question'): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'live-safety-action', actionKind,
    questionCode: actionKind === 'question' ? 'missing_workload' : null,
    currentUserMessage: '相談があります。', recentConversation: [], planningInformation: {},
    requiredLabels: [], fallbackText: '',
    previewCount: actionKind === 'preview_ready' ? 1 : 0,
    previewPromotionControlLabel: actionKind === 'preview_ready' ? 'この内容で仮予定にする' : null,
  };
}

function response(renderInput: WeeklyPlanningStableV5DialogueRenderInput, overrides: Record<string, unknown> = {}) {
  return {
    actionId: renderInput.actionId, actionKind: renderInput.actionKind, questionCode: renderInput.questionCode,
    groundingAcknowledgement: null, text: QUESTION, ...overrides,
  };
}

// Import the live parser directly. The legacy text oracle cannot establish
// coverage of the production transport/action and limited safety checks.
describe('Stable V5 live dialogue transport and non-semantic safety boundary', () => {
  it('rejects malformed JSON', () => {
    const rawResponse = '{invalid';
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, input())).toEqual({
      status: 'fallback', reason: 'invalid_json', rawResponse,
    });
  });

  it.each([
    ['null envelope', null],
    ['array envelope', []],
    ['string envelope', 'reply'],
    ['missing text', { ...response(input()), text: undefined }],
    ['non-string actionId', response(input(), { actionId: 123 })],
    ['non-string actionKind', response(input(), { actionKind: null })],
    ['invalid questionCode type', response(input(), { questionCode: false })],
    ['non-string text', response(input(), { text: null })],
  ])('rejects an invalid response shape: %s', (_name, value) => {
    const rawResponse = JSON.stringify(value);
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, input())).toEqual({
      status: 'fallback', reason: 'invalid_shape', rawResponse,
    });
  });

  it.each([
    { name: 'actionId', overrides: { actionId: 'another-action' }, reason: 'action_mismatch' },
    { name: 'actionKind', overrides: { actionKind: 'status' }, reason: 'action_contract_mismatch' },
    { name: 'questionCode', overrides: { questionCode: 'another-question' }, reason: 'action_contract_mismatch' },
  ])('rejects a mismatched application-selected $name', ({ overrides, reason }) => {
    const renderInput = input();
    const rawResponse = JSON.stringify(response(renderInput, overrides));
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, renderInput)).toEqual({
      status: 'fallback', reason, rawResponse,
    });
  });

  it.each([
    ['external URL', 'https://example.invalid'],
    ['sensitive value request', 'APIキーを教えてください。'],
    ['control character', '確認\u0001してください。'],
    ['over-length text', 'あ'.repeat(801)],
    ['empty text after trimming', ' \n\t '],
  ])('rejects unsafe text: %s', (_name, text) => {
    const renderInput = input();
    const rawResponse = JSON.stringify(response(renderInput, { text }));
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, renderInput)).toEqual({
      status: 'fallback', reason: 'unsafe_text', rawResponse,
    });
  });

  for (const actionKind of ['preview_ready', 'status', 'question'] as const) {
    it.each(['保存しました。', '予定に追加しました。', '承認しました。'])(`rejects a false completed operation on ${actionKind}: %s`, text => {
      const renderInput = input(actionKind);
      const rawResponse = JSON.stringify(response(renderInput, { text }));
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, renderInput)).toEqual({
        status: 'fallback', reason: 'ungrounded_text', rawResponse,
      });
    });
  }

  it('rejects a question identical to the most recent assistant message', () => {
    const renderInput = input();
    renderInput.recentConversation = [
      { role: 'assistant', content: '別の確認がありますか？' },
      { role: 'user', content: '相談があります。' },
      { role: 'assistant', content: QUESTION },
      { role: 'user', content: '説明してください。' },
    ];
    const rawResponse = JSON.stringify(response(renderInput));
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, renderInput)).toEqual({
      status: 'fallback', reason: 'repeated_question_text', rawResponse,
    });
  });

  it('renders a valid reply with matching application-selected identity', () => {
    const renderInput = input();
    const rawResponse = JSON.stringify(response(renderInput));
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, renderInput)).toEqual({
      status: 'rendered', text: QUESTION, rawResponse,
    });
  });

  it('allows safe text at the length limit', () => {
    const renderInput = input('status');
    const text = 'あ'.repeat(800);
    const rawResponse = JSON.stringify(response(renderInput, { text }));
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, renderInput)).toEqual({
      status: 'rendered', text, rawResponse,
    });
  });
});
