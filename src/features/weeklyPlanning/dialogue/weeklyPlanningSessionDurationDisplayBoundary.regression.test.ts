import { describe, expect, it } from 'vitest';
import capture from '../../../../tests/fixtures/weekly-session-duration-873.json';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { evaluateWeeklyPlanningLegacyDialogueTextGuard, parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';

function rendererInput(precision = 'exact'): WeeklyPlanningStableV5DialogueRenderInput {
  const effort = { id: 'session', taskId: 'english', targetFactId: 'amount', kind: 'session_duration', minutes: 60, precision };
  return {
    actionId: 'issue873-preview', actionKind: 'preview_ready', questionCode: null,
    currentUserMessage: capture.userText, recentConversation: [], requiredLabels: [], fallbackText: '',
    previewCount: 1, previewPromotionControlLabel: 'この内容で仮予定にする',
    planningInformation: {
      tasks: [{ id: 'english', title: '英語の勉強' }],
      workloads: [{ id: 'amount', taskId: 'english', quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分' }],
      components: [], effortEstimates: [effort],
      temporalConstraints: [{ taskId: 'english', dateExpression: 'tomorrow' }],
    },
    currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [{
      factId: 'session', kind: 'effort_estimate', sourceText: capture.userText,
      data: { ...effort, targetLabels: ['英語の勉強'] },
    }] },
  };
}

function response(input: WeeklyPlanningStableV5DialogueRenderInput, acknowledgement: string) {
  return JSON.stringify({ actionId: input.actionId, actionKind: input.actionKind, questionCode: input.questionCode,
    groundingAcknowledgement: { factIds: ['session'], text: acknowledgement },
    text: `${acknowledgement}候補の内容を確認してください。` });
}

describe('Issue #873: session duration display is independent of planning authority', () => {
  it.each(capture.replies)('renders $name verbatim without composing an application acknowledgement', reply => {
    const input = rendererInput(reply.precision);
    const before = structuredClone(input);
    const rawResponse = response(input, reply.acknowledgement);
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, input)).toEqual({
      status: 'rendered', text: JSON.parse(rawResponse).text, rawResponse,
    });
    expect(input).toEqual(before);
  });

  it('documents the original false rejection in the non-production legacy oracle', () => {
    const input = rendererInput();
    const rawResponse = response(input, capture.replies[0].acknowledgement);
    expect(evaluateWeeklyPlanningLegacyDialogueTextGuard(rawResponse, input)).toMatchObject({
      status: 'fallback', reason: 'grounding_contract_mismatch',
    });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, input).status).toBe('rendered');
  });

  it('retains the limited false-save claim guard on a preview-ready turn', () => {
    const input = rendererInput();
    const rawResponse = response(input, '保存しました。');
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, input)).toMatchObject({
      status: 'fallback', reason: 'ungrounded_text',
    });
  });
});
