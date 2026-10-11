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

  it.each(['9:00', '09:00', '9：00', '9時', '09時', '午前9時'])(
    'accepts only equivalent clock display grounded by canonical 09:00 (%s)', (clock) => {
      const renderInput = input({ planningInformation: {
        availabilityDeclarations: [{ kind: 'available', startTime: '09:00', endTime: '12:00' }],
      } });
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${clock}から12:00の間に何を進めたいですか？`), renderInput,
      )).toMatchObject({ status: 'rendered' });
    },
  );

  it('compares supported clock spellings by minutes symmetrically across the day', () => {
    for (const hour of [0, 1, 9, 12, 13, 21, 23]) for (const minute of [0, 5, 30, 59]) {
      const mm = String(minute).padStart(2, '0');
      const meridiem = hour < 12 ? '午前' : '午後';
      const hour12 = hour % 12 || 12;
      const forms = [`${String(hour).padStart(2, '0')}:${mm}`, `${hour}:${mm}`, `${hour}時${minute}分`,
        `${meridiem}${hour12}:${mm}`, `${meridiem}${hour12}時${minute}分`,
        ...(minute === 30 ? [`${meridiem}${hour12}時半`] : []),
      ];
      for (const source of forms) for (const target of forms) {
        const renderInput = input({ currentUserMessage: `基準は${source}です`, planningInformation: null });
        expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
          response(renderInput, `${target}から何を進めたいですか？`), renderInput,
        )).toMatchObject({ status: 'rendered' });
        const other = `${hour}:${String((minute + 1) % 60).padStart(2, '0')}`;
        expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
          response(renderInput, `${other}から何を進めたいですか？`), renderInput,
        )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
      }
    }
  });

  it.each(['08:00', '午後9時', '25:00', '29:00', '09:60', '109:00', '9時60分', '29時'])(
    'rejects different or invalid whole clock tokens without suffix matching (%s)', (clock) => {
      const renderInput = input({ planningInformation: {
        availabilityDeclarations: [{ kind: 'available', startTime: '09:00', endTime: '12:00' }],
      } });
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${clock}から何を進めたいですか？`), renderInput,
      )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    },
  );

  it('keeps sentence punctuation and time ranges outside valid clock tokens', () => {
    const renderInput = input({ planningInformation: {
      availabilityDeclarations: [{ kind: 'available', startTime: '09:00', endTime: '12:00' }],
    } });
    for (const text of ['9:00.', '9時.', '9:00．', '9:00。', '9:00,', '「9:00」',
      '09:00〜12:00', '09:00-12:00', '9時から12時まで']) {
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${text} 何を進めたいですか？`), renderInput,
      ), text).toMatchObject({ status: 'rendered' });
    }
  });

  it('rejects complete malformed or unsupported-precision tokens instead of valid fragments', () => {
    const renderInput = input({ planningInformation: {
      availabilityDeclarations: [{ kind: 'available', startTime: '09:00', endTime: '09:30' },
        { kind: 'available', startTime: '05:00' }],
    } });
    for (const clock of ['9:00:59', '9:00：59', '9::00', '9：：00', '9:00:', '9:00.5',
      '9時00分30秒', '9時30分半', '9時30.5分', '9:00秒', '9.5:00', '9.5時', '9..5:00']) {
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${clock}から何を進めたいですか？`), renderInput,
      ), clock).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    }
  });

  it('keeps meridiem in the clock meaning and rejects invalid meridiem combinations', () => {
    for (const [source, target] of [['09:00', '午後9:00'], ['21:00', '午前9:00'],
      ['13:00', '午後13時'], ['13:00', '午前13:00'], ['00:00', '午後12時'], ['12:00', '午前12:00']]) {
      const renderInput = input({ currentUserMessage: `基準は${source}です`, planningInformation: null });
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${target}から何を進めたいですか？`), renderInput,
      )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    }
  });

  it('retains grounded 24:00 day-end without treating it as same-day 00:00', () => {
    for (const [source, target, status] of [
      ['24:00', '24時', 'rendered'], ['24時', '24:00', 'rendered'],
      ['00:00', '24:00', 'fallback'], ['24:00', '0:00', 'fallback'],
      ['24:00', '24:01', 'fallback'], ['24:00', '午後12:00', 'fallback'],
    ]) {
      const renderInput = input({ currentUserMessage: `終了は${source}です`, planningInformation: null });
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${target}までの予定について、どの作業ですか？`), renderInput,
      )).toMatchObject({ status });
    }
  });

  it('does not turn quantity ratios into clock tokens or weaken preview-count and save claims', () => {
    const ordinary = input();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(ordinary, '演習と復習を1:2に分けますか？'), ordinary,
    )).toMatchObject({ status: 'rendered' });
    const preview = input({ actionKind: 'preview_ready', questionCode: null, previewCount: 1,
      previewPromotionControlLabel: 'この内容で仮予定にする',
      planningInformation: { availabilityDeclarations: [{ kind: 'available', startTime: '09:00' }] },
    });
    for (const text of ['9:00から2件の候補があります。', '9:00からの予定を保存しました。']) {
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(preview, `${text}この内容で仮予定にする`), preview,
      )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    }
  });

  it('grounds registration noun modifiers by current material identity and exact display names', () => {
    for (const actionKind of ['status', 'question'] as const) {
      const renderInput = input({ actionKind, questionCode: actionKind === 'question' ? 'quantity_role_unresolved' : null,
        currentUserMessage: '教材を使いたいです。', requiredLabels: [],
        planningInformation: { registeredMaterials: [
          { materialId: 'registered-b', name: '教材B', catalogTitle: '正式教材名', aliases: ['英語演習'] },
        ] },
      });
      for (const noun of ['教材B', '正式教材名', '英語演習', '「教材B」', '『英語演習』', '"正式教材名"']) {
        const text = `登録済みの${noun}で演習を進めたいのですね。`;
        expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput), text)
          .toMatchObject({ status: 'rendered' });
      }
    }
  });

  it('requires a current registered identity rather than user wording or another fact label', () => {
    for (const registeredMaterials of [undefined, [], [{ materialId: 'other', name: '教材C' }],
      [{ name: '教材B' }], [{ materialId: '', name: '教材B' }],
      [{ materialId: 'registered-b', name: '\u200b', aliases: ['\u200d'] }]]) {
      const renderInput = input({ actionKind: 'status', questionCode: null,
        currentUserMessage: '登録済みの教材Bを使いたいです。', requiredLabels: ['教材B'],
        planningInformation: { tasks: [{ title: '教材B' }], components: [{ label: '教材B' }], registeredMaterials },
      });
      for (const text of ['登録済みの教材Bで演習を進めたいのですね。', '登録済みのはじめての英語で進めたいのですね。']) {
        expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
          response(renderInput, text), renderInput,
        )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
      }
    }
  });

  it('retains ungrounded names, finite mutations, other attributes, and mixed-sentence operations', () => {
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [],
      planningInformation: { registeredMaterials: [{ materialId: 'registered-b', name: '教材B',
        aliases: ['危険な保存しました教材'] }] },
    });
    for (const text of ['登録済みの教材Cで進めます。', '登録済みの教材B改訂で進めます。',
      '登録済みの教材B2で進めます。', '教材Bを登録しました。', '教材Bは登録済みです。',
      '保存済みの教材Bで進めます。', '登録済みの教材Bを保存しました。',
      '登録済みの教材Bで進めます。予定を保存しました。',
      '登録済みの教材Bで進め、予定を登録しました。',
      '登録済みの危険な保存しました教材で進めます。']) {
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput), text)
        .toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    }
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
