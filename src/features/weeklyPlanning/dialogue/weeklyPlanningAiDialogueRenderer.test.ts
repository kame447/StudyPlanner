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
    '授業・バイト・通院など、動かせない予定があれば教えてください。',
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
          { slotKey: 'fixed_events', text: '固定予定はありますか？' },
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
          { slotKey: 'fixed_events', text: '固定予定はありますか？' },
          { slotKey: 'sleep_cycle', text: '睡眠時間はどうしますか？' },
        ],
      })),
    };

    await expect(renderWeeklyPlanningDialogueMessage({
      state: stateWithExtraMissing(),
      decision: missingDecision(),
      renderer,
    })).resolves.toContain('固定予定はありますか？');
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it('uses the existing OpenAI-compatible client with structured response format and renderer-only input', async () => {
    const client = createMockClient(JSON.stringify({
      acknowledgement: '条件を受け取りました。',
      questions: [
        { slotKey: 'fixed_events', text: '固定予定はありますか？' },
        { slotKey: 'sleep_cycle', text: '睡眠時間はどうしますか？' },
      ],
    }));
    const renderer = createAiWeeklyPlanningDialogueRenderer(config, client);
    const state = stateWithExtraMissing();
    const decision = missingDecision();

    await expect(renderWeeklyPlanningDialogueMessage({ state, decision, renderer })).resolves.toBe([
      '条件を受け取りました。',
      '固定予定はありますか？',
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
          vocabularyHint: '授業・バイト・通院など動かせない予定',
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
        { slotKey: 'fixed_events', text: '固定予定はありますか？' },
      ],
    })));

    await expect(renderWeeklyPlanningDialogueMessage({
      state: stateWithExtraMissing(),
      decision: missingDecision(),
      renderer,
    })).resolves.toBe([
      '確認しました。',
      '固定予定はありますか？',
      '睡眠時間はどうしますか？',
    ].join('\n'));
  });

  it.each([
    [
      'plan outside slot',
      {
        questions: [
          { slotKey: 'fixed_events', text: '固定予定はありますか？' },
          { slotKey: 'daily_target', text: '毎日の目標も教えてください。' },
        ],
      },
    ],
    [
      'missing planned slot',
      {
        questions: [
          { slotKey: 'fixed_events', text: '固定予定はありますか？' },
        ],
      },
    ],
    [
      'duplicate planned slot',
      {
        questions: [
          { slotKey: 'fixed_events', text: '固定予定はありますか？' },
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
        { slotKey: 'fixed_events', text: '固定予定はありますか？' },
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

    expect(fixedEvents?.vocabularyHint).toBe('授業・バイト・通院など動かせない予定');
  });

  it('surfaces constraint sources already in use as plain labels', () => {
    const state: PlanningIntakeState = {
      ...stateWithNextWeekRange(),
      constraintSourcesInUse: [{ kind: 'timetable', selector: 'active' }],
    };

    const input = createDialogueRenderInput({ state, decision: askScopeDecision() });

    expect(input.constraintSourcesInUse).toEqual(['時間割']);
  });

  it('does not mutate questionPlan after adopting AI text (regression guard)', async () => {
    const renderer = createAiWeeklyPlanningDialogueRenderer(config, createMockClient(JSON.stringify({
      questions: [
        { slotKey: 'fixed_events', text: '固定予定はありますか？' },
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
