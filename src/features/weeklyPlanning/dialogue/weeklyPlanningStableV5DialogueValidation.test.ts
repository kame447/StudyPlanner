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
    groundingAcknowledgement: null | {
      factIds: string[];
      text: string;
    };
  }> = {},
): string {
  return JSON.stringify({
    actionId: overrides.actionId ?? renderInput.actionId,
    actionKind: overrides.actionKind ?? renderInput.actionKind,
    questionCode: overrides.questionCode === undefined
      ? renderInput.questionCode
      : overrides.questionCode,
    ...(overrides.groundingAcknowledgement === undefined
      ? {}
      : { groundingAcknowledgement: overrides.groundingAcknowledgement }),
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

  it('rejects an identical repeat of the most recent assistant question', () => {
    const previousQuestion = '院試の第2分野について、今回進めたい量ですか？';
    const renderInput = input({
      currentUserMessage: 'その質問は何を確認したいの？',
      recentConversation: [
        { role: 'user', content: '院試を進めたい' },
        { role: 'assistant', content: previousQuestion },
      ],
    });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `  ${previousQuestion}\n`),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'repeated_question_text' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '予定に入れる量を決めるための確認です。今回はどれくらい進めたいですか？'),
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

  it('requires an observable accepted-fact acknowledgement before resuming a pending question', () => {
    const renderInput = input({
      actionId: 'stable-v5:request-complete:missing_schedulable_work',
      currentUserMessage: 'もう100%終わっています',
      currentTurnGrounding: {
        mode: 'required_before_resume',
        acceptedFacts: [{
          factId: 'workload-completed-100',
          kind: 'workload',
          sourceText: 'もう100%終わっています',
          data: {
            taskId: 'task-slides',
            quantityRole: 'completed',
            amount: 100,
            unitCode: 'custom',
            unitLabel: '%',
          },
        }],
      },
      planningInformation: {
        tasks: [{ id: 'task-slides', title: '夏合宿の発表スライド', category: 'non_study' }],
        workloads: [{
          id: 'workload-completed-100',
          taskId: 'task-slides',
          quantityRole: 'completed',
          amount: 100,
          unitCode: 'custom',
          unitLabel: '%',
        }],
      },
      questionCode: 'missing_schedulable_work',
      questionIntent: {
        kind: 'schedulable_work_detail',
        mode: 'all_requested_work_complete',
        targetFactId: null,
        progressBasis: null,
        knownUnitCode: null,
        knownUnitLabel: null,
        requestedInformation: ['additional_task_or_constraint'],
      },
      requiredLabels: [],
      fallbackText: '指定された作業は完了済みです。ほかに予定へ加えたい作業や、考慮したい予定・制約があれば教えてください。',
    });
    const acknowledgement = 'スライドは100%まで完了しているんですね。';
    const continuation = 'ほかに予定へ加えたい作業や、考慮したい予定・制約はありますか？';

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, continuation),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `${acknowledgement}${continuation}`, {
        groundingAcknowledgement: {
          factIds: ['other-fact'],
          text: acknowledgement,
        },
      }),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `${continuation}${acknowledgement}`, {
        groundingAcknowledgement: {
          factIds: ['workload-completed-100'],
          text: acknowledgement,
        },
      }),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `${acknowledgement}${continuation}`, {
        groundingAcknowledgement: {
          factIds: ['workload-completed-100'],
          text: acknowledgement,
        },
      }),
      renderInput,
    )).toMatchObject({ status: 'rendered' });
  });

  it('requires a resumed-question ACK to preserve the accepted concrete clock value', () => {
    const renderInput = input({
      actionId: 'stable-v5:request-deadline:missing_schedulable_work',
      currentUserMessage: '締切は明日の13時です',
      currentTurnGrounding: {
        mode: 'required_before_resume',
        acceptedFacts: [{
          factId: 'deadline-13',
          kind: 'temporal_constraint',
          sourceText: '締切は明日の13時です',
          data: {
            taskId: 'task-report',
            targetFactId: 'task-report',
            kind: 'deadline',
            constraintLevel: 'hard',
            dateExpression: 'tomorrow',
            namedTimePeriod: null,
            startTime: null,
            endTime: '13:00',
            precision: 'exact',
          },
        }],
      },
      planningInformation: {
        tasks: [{ id: 'task-report', title: '研究室のレポート', category: 'study' }],
        temporalConstraints: [{
          id: 'deadline-13',
          taskId: 'task-report',
          kind: 'deadline',
          dateExpression: 'tomorrow',
          endTime: '13:00',
        }],
      },
      questionCode: 'missing_schedulable_work',
      requiredLabels: ['研究室のレポート'],
      fallbackText: '完成を100%とすると、今はだいたい何%くらいまで進んでいますか？',
    });
    const continuation = '研究室のレポートは、完成を100%とすると現在どのくらい進んでいますか？';
    const genericAck = '締切の情報を受け取りました。';
    const groundedAck = '締切は明日の13時ですね。';

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `${genericAck}${continuation}`, {
        groundingAcknowledgement: {
          factIds: ['deadline-13'],
          text: genericAck,
        },
      }),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `${groundedAck}${continuation}`, {
        groundingAcknowledgement: {
          factIds: ['deadline-13'],
          text: groundedAck,
        },
      }),
      renderInput,
    )).toMatchObject({ status: 'rendered' });
  });

  it('rejects ungrounded dates, clock times, unsafe content, and malformed JSON', () => {
    const renderInput = input();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '明日の20時から3時間進める予定として扱います。'),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, 'https://example.test を開いてください。'),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'unsafe_text' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      'not-json',
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'invalid_json' });
  });

  it('rejects premature claims that a task was already put into a plan before preview', () => {
    const renderInput = input({
      currentUserMessage: '研究室のレポートを仕上げたいです',
      questionCode: 'missing_schedulable_work',
    });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '明日の予定に、研究室のレポートを仕上げる作業を入れます。全体量を教えてください。'),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '研究室のレポートを仕上げたいのですね。全体量を教えてください。'),
      renderInput,
    )).toMatchObject({ status: 'rendered' });
  });

  it('keeps preview prose dynamic while requiring the typed promotion control', () => {
    const previewInput = input({
      actionId: 'stable-v5:request-preview:preview_ready',
      currentUserMessage: 'それで作って',
      actionKind: 'preview_ready',
      questionCode: null,
      previewPromotionControlLabel: 'この内容で仮予定にする',
      requiredLabels: ['この内容で仮予定にする'],
      fallbackText: '2件の仮予定候補を作りました。',
      previewCount: 2,
    });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(previewInput, '候補を確認して、よければ「この内容で仮予定にする」を押してください。'),
      previewInput,
    )).toMatchObject({ status: 'rendered' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(previewInput, '仮予定候補を確認してください。'),
      previewInput,
    )).toMatchObject({ status: 'fallback', reason: 'action_contract_mismatch' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(previewInput, '3件の候補です。「この内容で仮予定にする」を押してください。'),
      previewInput,
    )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
});
