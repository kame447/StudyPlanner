import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { renderWeeklyPlanningStableV5AssistantMessageCore } from './weeklyPlanningStableV5TurnDialogueCore';
import type { WeeklyPlanningTurnExecutionInput, WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import type { WeeklyPlanningTurnDialoguePorts } from './weeklyPlanningStableV5TurnDialogueCore';

const TECHNICAL_STOP = '返信を作れませんでした。少し待ってからもう一度送信してください。';
const MISLEADING_QUESTION = '「今日の予定立てて」の意味を一つに決められませんでした。この部分だけ、もう少し具体的に教えてください。';

function request(): WeeklyPlanningTurnExecutionInput {
  return {
    userId: 'owner-typed-fallback',
    conversationId: 'conversation-typed-fallback',
    traceRequestId: 'conversation-typed-fallback:request:3',
    userText: '研究で使う対話型AIの実装やね',
    selectedDate: '2026-10-14',
    messages: [],
    plans: [],
    scheduleTemplates: [],
  };
}

function pendingQuestionResult(questionCode: string): WeeklyPlanningTurnExecutionResult {
  return {
    state: {
      ...createInitialPlanningIntakeState(),
      status: 'revision_pending',
      questions: [MISLEADING_QUESTION],
      lastQuestionContext: {
        kind: 'missing',
        targetSlot: `stable_v5:${questionCode}`,
        intent: questionCode,
      },
    },
    message: MISLEADING_QUESTION,
    draftCandidates: [],
  } as WeeklyPlanningTurnExecutionResult;
}

function ports(status: 'fallback' | 'rendered'): WeeklyPlanningTurnDialoguePorts {
  return {
    createRenderer: () => ({
      render: async () => status === 'fallback'
        ? { status: 'fallback', reason: 'provider_error', rawResponse: null } as const
        : { status: 'rendered', text: '掃除と研究の予定は受け取っています。時間帯の希望はありますか？', rawResponse: '{"text":"rendered"}' } as const,
    }),
    getSession: () => null,
  } as WeeklyPlanningTurnDialoguePorts;
}

describe('renderer outage is not a semantic clarification', () => {
  it.each([
    'semantic_uncertainty',
    'missing_effort_estimate',
    'missing_schedulable_work',
    'quantity_role_unresolved',
  ])('never presents a pending %s question when provider rendering fails', async code => {
    const first = pendingQuestionResult(code);
    const result = await renderWeeklyPlanningStableV5AssistantMessageCore({
      input: request(),
      result: first,
    }, ports('fallback'));

    expect(result.message).toBe(TECHNICAL_STOP);
    expect(result.message).not.toBe(MISLEADING_QUESTION);
    expect(result.responseSource).toBe('deterministic_fallback');
    expect(result.state.questions).toEqual([]);
    expect(result.state.lastQuestionContext).toMatchObject({ targetSlot: `stable_v5:${code}` });
    expect(result.state.lastQuestionContext?.presentation).toBeUndefined();
    expect(result.questionPresentationContent).toBeUndefined();
    expect(result.dialogueRendererTrace).toMatchObject({
      actionKind: 'question',
      questionCode: code,
      request: { fallbackText: TECHNICAL_STOP },
      response: { status: 'fallback', reason: 'provider_error', rawResponse: null },
      decision: {
        branch: 'deterministic_fallback',
        responseSource: 'deterministic_fallback',
        finalMessage: TECHNICAL_STOP,
      },
    });
  });

  it('allows the pending machine question to be rendered after provider recovery', async () => {
    const input = request();
    const original = pendingQuestionResult('semantic_uncertainty');
    const failed = await renderWeeklyPlanningStableV5AssistantMessageCore({
      input, result: original,
    }, ports('fallback'));
    const recovered = await renderWeeklyPlanningStableV5AssistantMessageCore({
      input, result: { ...original, state: failed.state },
    }, ports('rendered'));

    expect(failed.state.questions).toEqual([]);
    expect(recovered.responseSource).toBe('ai');
    expect(recovered.message).toContain('時間帯の希望');
    // Machine-owned context survives but the unpresented error cannot be
    // bound as a fresh question until the renderer actually succeeds.
    expect(recovered.state.lastQuestionContext).toEqual(failed.state.lastQuestionContext);
    expect(recovered.questionPresentationContent).toBeDefined();
  });
});
