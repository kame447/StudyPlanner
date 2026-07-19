import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { WeeklyPlanningDialogueDecision } from '../dialogue/weeklyPlanningDialogueManager';
import {
  createAiWeeklyPlanningDialogueRenderer,
  WEEKLY_PLANNING_DIALOGUE_RENDERER_RESPONSE_FORMAT,
} from '../dialogue/weeklyPlanningAiDialogueRenderer';
import {
  createDialogueRenderInput,
  renderWeeklyPlanningDialogueMessage,
} from '../dialogue/weeklyPlanningDialogueRenderer';
import {
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import type { PlanningIntakeMissing, PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';

const config: AiConfig = {
  provider: 'openai',
  baseUrl: 'https://example.test/v1',
  model: 'configured-model',
  apiKey: 'test-key',
};

function createMockClient(contentOrError: string | Error): OpenAiCompatibleClient {
  return {
    createChatCompletion: vi.fn(async () => {
      if (contentOrError instanceof Error) {
        throw contentOrError;
      }

      return contentOrError;
    }),
  };
}

function missingDecision(): WeeklyPlanningDialogueDecision {
  return {
    kind: 'ask_missing_info',
    messageKey: 'ask_life_constraints',
    requiredFields: ['fixed_events', 'sleep_cycle'],
    questionPlan: [
      {
        kind: 'missing_life_constraint',
        targetSlot: 'fixed_events',
        missing: ['fixed_events'],
        intent: 'ask_fixed_events',
      },
      {
        kind: 'missing_life_constraint',
        targetSlot: 'sleep_cycle',
        missing: ['sleep_cycle'],
        intent: 'ask_life_constraints',
      },
    ],
    shouldCreateDraft: false,
    shouldSavePlan: false,
  };
}

function fallbackMessage(): string {
  return [
    'ここまでの条件を確認しました。',
    'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？',
    '睡眠時間や、何時から勉強を始められるかを教えてください。',
  ].join('\n');
}

function stateWithExtraMissing() {
  return {
    ...createInitialPlanningIntakeState(),
    missing: [
      'fixed_events',
      'sleep_cycle',
      'meal_bath_constraints',
      'unit_duration_estimate',
    ] as PlanningIntakeMissing[],
  };
}

describe('weekly planning AI dialogue renderer', () => {

  it('does not call the AI renderer when the decision has no questions', async () => {
    const renderer = {
      render: vi.fn(async () => ({
        questions: [
          { slotKey: 'fixed_events', text: 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？' },
        ],
      })),
    };
    const decision: WeeklyPlanningDialogueDecision = {
      kind: 'offer_dry_run_preview',
      messageKey: 'offer_weekly_plan_dry_run_preview',
      summary: {
        remainingWorkItemCount: 2,
        totalRequestedMinutes: 120,
        totalScheduledMinutes: 120,
        unscheduledItemCount: 0,
      },
      shouldCreateDraft: true,
      shouldSavePlan: false,
    };

    await expect(renderWeeklyPlanningDialogueMessage({
      state: createInitialPlanningIntakeState(),
      decision,
      renderer,
    })).resolves.toContain('仮予定候補');
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('renders only untargeted completion target fields from questionPlan context', async () => {
    const decision: WeeklyPlanningDialogueDecision = {
      kind: 'ask_missing_info',
      messageKey: 'ask_progress_clarification',
      requiredFields: ['progress'],
      questionPlan: [
        {
          kind: 'missing_slot',
          targetSlot: 'progress',
          missing: ['progress'],
          intent: 'ask_progress_clarification',
          targetFields: ['C'],
        },
      ],
      shouldCreateDraft: false,
      shouldSavePlan: false,
    };

    await expect(renderWeeklyPlanningDialogueMessage({
      state: createInitialPlanningIntakeState(),
      decision,
    })).resolves.toContain('Cはどこまで進めたいですか？');
  });

  it('still calls the AI renderer when missing-info questions are planned', async () => {
    const renderer = {
      render: vi.fn(async () => ({
        acknowledgement: '条件を受け取りました。',
        questions: [
          { slotKey: 'fixed_events', text: 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？' },
          { slotKey: 'sleep_cycle', text: '睡眠時間はどうしますか？' },
        ],
      })),
    };

    await expect(renderWeeklyPlanningDialogueMessage({
      state: stateWithExtraMissing(),
      decision: missingDecision(),
      renderer,
    })).resolves.toContain('すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？');
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it('omits a generic acknowledgement from renderer output', async () => {
    const renderer = {
      render: vi.fn(async () => ({
        acknowledgement: '了解です。',
        questions: [
          { slotKey: 'fixed_events', text: 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？' },
          { slotKey: 'sleep_cycle', text: '睡眠時間はどうしますか？' },
        ],
      })),
    };

    const message = await renderWeeklyPlanningDialogueMessage({
      state: stateWithExtraMissing(),
      decision: missingDecision(),
      renderer,
    });

    expect(message).not.toContain('了解です');
    expect(message).toBe([
      'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？',
      '睡眠時間はどうしますか？',
    ].join('\n'));
  });

  it('replaces an AI-authored yearly-plan acknowledgement with controlled accepted-fact vocabulary', async () => {
    const state: PlanningIntakeState = {
      ...stateWithExtraMissing(),
      examPrepScope: {
        fields: ['OSnetwork'],
        totalFields: 1,
        unitModel: 'year_field_chunk',
        rawText: ['OSnetwork'],
      },
    };
    const renderer = {
      render: vi.fn(async () => ({
        acknowledgement: '年度の計画ですね。',
        questions: [
          { slotKey: 'fixed_events', text: 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？' },
          { slotKey: 'sleep_cycle', text: '睡眠時間はどうしますか？' },
        ],
      })),
    };

    const message = await renderWeeklyPlanningDialogueMessage({
      state,
      decision: missingDecision(),
      renderer,
    });

    expect(message).toContain('OSnetworkを1科目で受け取りました。');
    expect(message).not.toContain('年度の計画');
  });

  it('passes the canonical exam unit-rate basis to the AI question renderer', async () => {
    const client = createMockClient(JSON.stringify({
      questions: [
        { slotKey: 'unit_rate', text: '1年分・1分野あたり、どれくらいかかりますか？' },
      ],
    }));
    const renderer = createAiWeeklyPlanningDialogueRenderer(config, client);
    const state: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      examPrepScope: {
        fields: ['OSnetwork'],
        totalFields: 1,
        unitModel: 'year_field_chunk',
        rawText: ['OSnetwork'],
      },
      missing: ['unit_duration_estimate'],
    };
    const decision: WeeklyPlanningDialogueDecision = {
      kind: 'ask_missing_info',
      messageKey: 'ask_unit_rate',
      questionPlan: [{
        kind: 'missing_slot',
        targetSlot: 'unit_rate',
        missing: ['unit_duration_estimate'],
        intent: 'ask_unit_rate',
      }],
      shouldCreateDraft: false,
      shouldSavePlan: false,
    };

    await renderWeeklyPlanningDialogueMessage({ state, decision, renderer });

    const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    const userPayload = JSON.parse(request.messages[1].content) as {
      unitRateBasisLabel?: string;
      nextQuestions: Array<{ vocabularyHint?: string }>;
      targetUnitLabel?: string;
    };
    expect(userPayload.unitRateBasisLabel).toBe('1年分・1分野あたり');
    expect(userPayload.nextQuestions[0].vocabularyHint).toBe(
      '1年分・1分野あたりの目安時間',
    );
    expect(userPayload.targetUnitLabel).toBeUndefined();
  });

  it('falls back when two planned questions render as the same visible text', async () => {
    const duplicate = 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？';
    const renderer = {
      render: vi.fn(async () => ({
        questions: [
          { slotKey: 'fixed_events', text: duplicate },
          { slotKey: 'sleep_cycle', text: duplicate },
        ],
      })),
    };

    await expect(renderWeeklyPlanningDialogueMessage({
      state: stateWithExtraMissing(),
      decision: missingDecision(),
      renderer,
    })).resolves.toBe(fallbackMessage());
  });

  it('uses the existing OpenAI-compatible client with structured response format and renderer-only input', async () => {
    const client = createMockClient(JSON.stringify({
      acknowledgement: '条件を受け取りました。',
      questions: [
        { slotKey: 'fixed_events', text: 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？' },
        { slotKey: 'sleep_cycle', text: '睡眠時間はどうしますか？' },
      ],
    }));
    const renderer = createAiWeeklyPlanningDialogueRenderer(config, client);
    const state = stateWithExtraMissing();
    const decision = missingDecision();

    await expect(renderWeeklyPlanningDialogueMessage({ state, decision, renderer })).resolves.toBe([
      'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？',
      '睡眠時間はどうしますか？',
    ].join('\n'));

    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(client.createChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      temperature: 0.2,
      responseFormat: WEEKLY_PLANNING_DIALOGUE_RENDERER_RESPONSE_FORMAT,
      purpose: 'weekly_planning_renderer',
    }));
    const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    const userPayload = JSON.parse(request.messages[1].content) as Record<string, unknown>;

    expect(userPayload).toEqual({
      acceptedFacts: {},
      assumptions: [],
      nextQuestions: [
        {
          slotKey: 'fixed_events',
          intent: 'ask_fixed_events',
          questionKind: 'missing_life_constraint',
          vocabularyHint: '時間が決まっていて動かせない予定',
        },
        {
          slotKey: 'sleep_cycle',
          intent: 'ask_life_constraints',
          questionKind: 'missing_life_constraint',
          vocabularyHint: '睡眠時間や、何時から勉強を始められるか',
        },
      ],
      styleConstraints: { tone: 'mentor', maxQuestions: 2 },
    });
    expect(request.messages[1].content).not.toContain('unit_duration_estimate');
    expect(request.messages[1].content).not.toContain('meal_bath_constraints');
  });

  it('restores final output to questionPlan order when AI returns planned slots out of order', async () => {
    const renderer = createAiWeeklyPlanningDialogueRenderer(config, createMockClient(JSON.stringify({
      acknowledgement: '確認しました。',
      questions: [
        { slotKey: 'sleep_cycle', text: '睡眠時間はどうしますか？' },
        { slotKey: 'fixed_events', text: 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？' },
      ],
    })));

    await expect(renderWeeklyPlanningDialogueMessage({
      state: stateWithExtraMissing(),
      decision: missingDecision(),
      renderer,
    })).resolves.toBe([
      'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？',
      '睡眠時間はどうしますか？',
    ].join('\n'));
  });

  it.each([
    [
      'plan outside slot',
      {
        questions: [
          { slotKey: 'fixed_events', text: 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？' },
          { slotKey: 'daily_target', text: '毎日の目標も教えてください。' },
        ],
      },
    ],
    [
      'missing planned slot',
      {
        questions: [
          { slotKey: 'fixed_events', text: 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？' },
        ],
      },
    ],
    [
      'duplicate planned slot',
      {
        questions: [
          { slotKey: 'fixed_events', text: 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？' },
          { slotKey: 'fixed_events', text: '固定予定をもう一度教えてください。' },
        ],
      },
    ],
  ])('falls back to deterministic rendering for invalid AI output: %s', async (_label, response) => {
    const renderer = createAiWeeklyPlanningDialogueRenderer(config, createMockClient(JSON.stringify(response)));

    await expect(renderWeeklyPlanningDialogueMessage({
      state: stateWithExtraMissing(),
      decision: missingDecision(),
      renderer,
    })).resolves.toBe(fallbackMessage());
  });

  it('falls back to deterministic rendering for schema parse failure', async () => {
    const renderer = createAiWeeklyPlanningDialogueRenderer(config, createMockClient('not json'));

    await expect(renderWeeklyPlanningDialogueMessage({
      state: stateWithExtraMissing(),
      decision: missingDecision(),
      renderer,
    })).resolves.toBe(fallbackMessage());
  });

  it('falls back to deterministic rendering for AI call failure', async () => {
    const renderer = createAiWeeklyPlanningDialogueRenderer(config, createMockClient(new Error('network down')));

    await expect(renderWeeklyPlanningDialogueMessage({
      state: stateWithExtraMissing(),
      decision: missingDecision(),
      renderer,
    })).resolves.toBe(fallbackMessage());
  });

  it('does not mutate questionPlan after adopting AI text', async () => {
    const renderer = createAiWeeklyPlanningDialogueRenderer(config, createMockClient(JSON.stringify({
      questions: [
        { slotKey: 'fixed_events', text: 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？' },
        { slotKey: 'sleep_cycle', text: '睡眠時間はどうしますか？' },
      ],
    })));
    const decision = missingDecision();
    const before = JSON.parse(JSON.stringify(decision)) as WeeklyPlanningDialogueDecision;

    await renderWeeklyPlanningDialogueMessage({
      state: stateWithExtraMissing(),
      decision,
      renderer,
    });

    expect(decision).toEqual(before);
  });
});

function askScopeDecision(): WeeklyPlanningDialogueDecision {
  return {
    kind: 'ask_missing_info',
    messageKey: 'ask_scope',
    requiredFields: ['tasks_or_goals'],
    questionPlan: [
      {
        kind: 'missing_slot',
        targetSlot: 'tasks_or_goals',
        missing: ['tasks_or_goals'],
        intent: 'ask_scope',
      },
    ],
    shouldCreateDraft: false,
    shouldSavePlan: false,
  };
}

function stateWithNextWeekRange(): PlanningIntakeState {
  return {
    ...createInitialPlanningIntakeState(),
    range: {
      startDateTime: '2026-07-13T00:00:00',
      endDateTime: '2026-07-19T24:00:00',
      sourceText: '来週、過去問を進めたい',
      confidence: 'inferred',
    },
    missing: ['tasks_or_goals'] as PlanningIntakeMissing[],
  };
}

describe('weekly planning renderer deterministic context', () => {
  it('carries the planning period label from range.sourceText into the render input', () => {
    const input = createDialogueRenderInput({
      state: stateWithNextWeekRange(),
      decision: askScopeDecision(),
    });

    expect(input.planningPeriodLabel).toBe('来週');
  });

  it('does not fabricate a week: deterministic fallback says 来週, never 今週', async () => {
    const message = await renderWeeklyPlanningDialogueMessage({
      state: stateWithNextWeekRange(),
      decision: askScopeDecision(),
    });

    expect(message).toContain('来週');
    expect(message).not.toContain('今週');
  });

  it('omits the period label when the user never stated one (no fabrication)', async () => {
    const state = {
      ...createInitialPlanningIntakeState(),
      missing: ['tasks_or_goals'] as PlanningIntakeMissing[],
    };
    const input = createDialogueRenderInput({ state, decision: askScopeDecision() });
    const message = await renderWeeklyPlanningDialogueMessage({ state, decision: askScopeDecision() });

    expect(input.planningPeriodLabel).toBeUndefined();
    expect(message).not.toContain('来週');
    expect(message).not.toContain('今週');
  });

  it('supplies a plain-vocabulary hint for internal slot keys (fixed_events)', () => {
    const input = createDialogueRenderInput({
      state: stateWithExtraMissing(),
      decision: missingDecision(),
    });

    const fixedEvents = input.nextQuestions.find((question) => question.slotKey === 'fixed_events');

    expect(fixedEvents?.vocabularyHint).toBe('時間が決まっていて動かせない予定');
  });

  it('surfaces constraint sources already in use as plain labels', () => {
    const state: PlanningIntakeState = {
      ...stateWithNextWeekRange(),
      constraintSourcesInUse: [{ kind: 'timetable', selector: 'active' }],
    };

    const input = createDialogueRenderInput({ state, decision: askScopeDecision() });

    expect(input.constraintSourcesInUse).toEqual(['時間割']);
  });

  function pendingStartState(): PlanningIntakeState {
    return {
      ...createInitialPlanningIntakeState(),
      intent: 'weekly_study_planning',
      pendingPlanningRange: {
        scope: {
          kind: 'next_week',
          label: '来週',
          windowStartDate: '2026-07-13',
          windowEndDate: '2026-07-19',
        },
        durationDays: 7,
        sourceText: '来週の計画を立てたい',
      },
      missing: ['planning_start_date'],
    };
  }

  function askPlanningStartDateDecision(): WeeklyPlanningDialogueDecision {
    return {
      kind: 'ask_missing_info',
      messageKey: 'ask_planning_start_date',
      requiredFields: ['planning_start_date'],
      questionPlan: [{
        kind: 'missing_slot',
        targetSlot: 'planning_start_date',
        missing: ['planning_start_date'],
        intent: 'ask_planning_start_date',
      }],
      shouldCreateDraft: false,
      shouldSavePlan: false,
    };
  }

  it('renders a pending planning start question with its user-provided period label', async () => {
    const message = await renderWeeklyPlanningDialogueMessage({
      state: pendingStartState(),
      decision: askPlanningStartDateDecision(),
    });

    expect(message).toContain('来週');
    expect(message).toContain('計画は、いつから始め');
    expect(message).not.toContain('どの日から');
    expect(message).not.toContain('次に確認したい条件を教えてください。');
  });

  it('passes the pending period label and start-date vocabulary hint to renderers', () => {
    const input = createDialogueRenderInput({
      state: pendingStartState(),
      decision: askPlanningStartDateDecision(),
    });
    const startDateQuestion = input.nextQuestions.find(
      (question) => question.slotKey === 'planning_start_date',
    );

    expect(input.planningPeriodLabel).toBe('来週');
    expect(startDateQuestion?.vocabularyHint).toBeDefined();
  });

  it('passes the pending period label through the AI renderer input path', async () => {
    const render = vi.fn(async () => ({
      questions: [{
        slotKey: 'planning_start_date',
        text: '来週のどの日から計画を始めますか？',
      }],
    }));

    const message = await renderWeeklyPlanningDialogueMessage({
      state: pendingStartState(),
      decision: askPlanningStartDateDecision(),
      renderer: { render },
    });

    expect(message).toContain('来週の計画は、いつから始めますか？');
    expect(message).not.toContain('どの日から');
    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      planningPeriodLabel: '来週',
      nextQuestions: [
        expect.objectContaining({
          slotKey: 'planning_start_date',
          vocabularyHint: expect.any(String),
        }),
      ],
    }));
  });
  it('includes command-derived goal titles in deterministic accepted facts', async () => {
    const state: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      tasks: [{
        title: '数学のテスト勉強',
        subject: '数学',
        unit: 'unknown',
        rawText: '数学のテスト勉強したい',
        requiresTimeEstimate: true,
        source: 'command',
      }, {
        title: '英語',
        subject: '英語',
        unit: 'minutes',
        amount: 120,
        rawText: '英語を2時間',
        requiresTimeEstimate: false,
        source: 'legacy_fallback',
      }],
    };
    const input = createDialogueRenderInput({
      state,
      decision: {
        kind: 'open_planning_dialogue',
        messageKey: 'open_weekly_planning_dialogue',
        shouldCreateDraft: false,
        shouldSavePlan: false,
      },
    });

    expect(input.acceptedFacts.goals).toEqual(['数学のテスト勉強']);
    const message = await renderWeeklyPlanningDialogueMessage({
      state: {
        ...state,
        missing: ['planning_start_date'],
      },
      decision: {
        kind: 'ask_missing_info',
        messageKey: 'ask_planning_start_date',
        requiredFields: ['planning_start_date'],
        questionPlan: [{
          kind: 'missing_slot',
          targetSlot: 'planning_start_date',
          missing: ['planning_start_date'],
          intent: 'ask_planning_start_date',
        }],
        shouldCreateDraft: false,
        shouldSavePlan: false,
      },
    });
    expect(message).toContain(String.fromCodePoint(0x76ee,0x6a19,0x306f,0x6570,0x5b66,0x306e,0x30c6,0x30b9,0x30c8,0x52c9,0x5f37));
  });

});
