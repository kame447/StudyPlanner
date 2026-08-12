import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import {
  parseWeeklyPlanningStableV5DialogueRendererResponse,
} from './weeklyPlanningStableV5DialogueValidation';

function input(
  overrides: Partial<WeeklyPlanningStableV5DialogueRenderInput> = {},
): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-1:quantity_role_unresolved',
    currentUserMessage: 'どういうこと？',
    recentConversation: [],
    planningInformation: {
      tasks: [{ title: '院試', category: 'study' }],
    },
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    requiredLabels: ['院試'],
    fallbackText: '今回進めたい量ですか？',
    previewCount: 0,
    ...overrides,
  };
}

function response(
  renderInput: WeeklyPlanningStableV5DialogueRenderInput,
  text: string,
  overrides: Partial<{
    actionId: string;
    actionKind: string;
    questionCode: string | null;
  }> = {},
): string {
  return JSON.stringify({
    actionId: overrides.actionId ?? renderInput.actionId,
    actionKind: overrides.actionKind ?? renderInput.actionKind,
    questionCode: overrides.questionCode === undefined
      ? renderInput.questionCode
      : overrides.questionCode,
    text,
  });
}

describe('Stable V5 dialogue renderer validation', () => {
  it('accepts grounded explanation wording without requiring deterministic labels', () => {
    const renderInput = input();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '今回の週間計画に何時間分を入れるべきか確認したい、ということです。'),
      renderInput,
    )).toMatchObject({ status: 'rendered' });
  });

  it('rejects action identity and question contract changes', () => {
    const renderInput = input();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '今回進める量ですか？', { actionId: 'other-action' }),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'action_mismatch' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, 'いつからいつまでですか？', { questionCode: 'invalid_planning_horizon' }),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'action_contract_mismatch' });
  });

  it('rejects ungrounded dates, clock times, unsafe content, and malformed JSON', () => {
    const renderInput = input();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '明日の20時から3時間進める予定として扱います。'),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, 'APIキーを送ってください。'),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'unsafe_text' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      'not-json',
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'invalid_json' });
  });

  it('allows omitting preview counts but rejects a conflicting count', () => {
    const previewInput = input({
      actionId: 'stable-v5:request-preview:preview_ready',
      currentUserMessage: 'それで作って',
      actionKind: 'preview_ready',
      questionCode: null,
      fallbackText: '2件の仮予定候補を作りました。',
      previewCount: 2,
    });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(previewInput, '仮予定を作りました。内容を確認してください。'),
      previewInput,
    )).toMatchObject({ status: 'rendered' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(previewInput, '3件の仮予定を作りました。'),
      previewInput,
    )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
});
