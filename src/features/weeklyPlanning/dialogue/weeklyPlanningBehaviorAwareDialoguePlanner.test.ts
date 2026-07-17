import { describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  createAllowedDialogueActions,
  createPlanningHypothesisSnapshot,
  evaluatePreviewGate,
} from '../planning/weeklyPlanningBehaviorPlanner';
import {
  createAiBehaviorAwareWeeklyPlanningDialoguePlanner,
  createDeterministicBehaviorAwareDialoguePlanner,
  WEEKLY_PLANNING_BEHAVIOR_DIALOGUE_RESPONSE_FORMAT,
} from './weeklyPlanningBehaviorAwareDialoguePlanner';

const config: AiConfig = {
  provider: 'openai',
  baseUrl: 'https://example.test/v1',
  model: 'configured-model',
  apiKey: 'test-key',
};

function state(sourceTurns: string[]): PlanningIntakeState {
  return {
    status: 'draft_ready',
    intent: 'weekly_study_planning',
    range: {
      startDateTime: '2026-07-13T00:00:00',
      endDateTime: '2026-07-19T23:59:59',
      calendarDayCount: 7,
      confidence: 'explicit',
      sourceText: '今週',
    },
    tasks: [{
      title: '英語ワーク',
      subject: '英語',
      unit: 'pages',
      amount: 10,
      rawText: '英語ワーク10ページ',
      requiresTimeEstimate: true,
      source: 'command',
    }],
    progress: [],
    unitRates: [{
      unit: 'pages',
      minutesPerUnit: 12,
      source: 'user',
    }],
    constraints: [{ kind: 'meal', start: '19:00', end: '20:00', hardness: 'hard' }],
    fixedEventsDeclaredNone: true,
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: true,
    shouldSavePlan: false,
    sourceTurns,
  };
}

function rangeOnlyState(): PlanningIntakeState {
  return {
    status: 'needs_scope',
    intent: 'weekly_study_planning',
    range: {
      startDateTime: '2026-07-15T00:00:00',
      endDateTime: '2026-07-19T23:59:59',
      calendarDayCount: 5,
      confidence: 'explicit',
      sourceText: '今日から日曜まで',
    },
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: ['tasks_or_goals'],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    sourceTurns: ['今日から日曜までの予定立てたい'],
  };
}

function input(value: PlanningIntakeState) {
  const snapshot = createPlanningHypothesisSnapshot({ state: value });
  const allowedActions = createAllowedDialogueActions(snapshot);
  const gate = evaluatePreviewGate({
    readiness: snapshot.readiness,
    currentStateRevision: value.sourceTurns.length,
    hasExecutionShape: true,
    hasAvailabilityBasis: true,
  });
  return {
    snapshot,
    allowedActions,
    acceptedFacts: {
      taskLabels: value.tasks.map((task) => task.title),
      planningPeriodLabel: '今週',
      constraintSummary: ['meal 19:00 20:00'],
    },
    previewAllowed: gate.allowed,
  };
}

describe('behavior-aware weekly planning AI dialogue planner', () => {
  it('accepts only allowed action ids and returns natural structured output', async () => {
    const value = state(['英語ワークを進めたい']);
    const plannerInput = input(value);
    const action = plannerInput.allowedActions.find((candidate) =>
      candidate.kind === 'suggest_draft_generation',
    ) ?? plannerInput.allowedActions.find((candidate) => candidate.kind !== 'acknowledge_fact');
    if (!action) {
      throw new Error('expected at least one substantive allowed action');
    }
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => JSON.stringify({
        acknowledgement: '英語ワークを10ページ進める予定ですね。',
        selectedActionIds: [action.actionId],
        items: [{
          actionId: action.actionId,
          text: 'まとまった時間で進める案が合いそうです。',
          optionIds: action.allowedOptionIds,
        }],
      })),
    };
    const planner = createAiBehaviorAwareWeeklyPlanningDialoguePlanner(config, client);

    const result = await planner.plan(plannerInput);

    expect(result.source).toBe('ai');
    expect(result.message).toContain('英語ワーク');
    expect(result.response?.selectedActionIds).toEqual([action.actionId]);
    expect(result.renderedActionIds).toEqual([action.actionId]);
  });

  it('uses a deterministic repetition for accepted facts and ignores an ungrounded AI acknowledgement', async () => {
    const value = state(['今週、英語ワークを進めたい。夕食は19時です']);
    const plannerInput = {
      ...input(value),
      recentConversation: [
        { role: 'assistant' as const, content: '何を進めますか？' },
        { role: 'user' as const, content: '今週、英語ワークを進めたい。夕食は19時です' },
      ],
    };
    const action = plannerInput.allowedActions.find((candidate) =>
      candidate.kind === 'suggest_draft_generation',
    );
    if (!action) throw new Error('expected draft suggestion action');
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => JSON.stringify({
        acknowledgement: '数学を20ページですね。',
        selectedActionIds: [action.actionId],
        items: [{ actionId: action.actionId, text: '仮予定を組む準備ができています。' }],
      })),
    };

    const result = await createAiBehaviorAwareWeeklyPlanningDialoguePlanner(config, client).plan(plannerInput);

    expect(result.source).toBe('ai');
    expect(result.message).toContain('計画期間は今週');
    expect(result.message).toContain('学習内容は「英語ワーク」');
    expect(result.message).toContain('食事 19:00〜20:00');
    expect(result.message).not.toContain('数学');
  });

  it('falls back when the AI invents an action', async () => {
    const value = state(['英語ワークを進めたい']);
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => JSON.stringify({
        selectedActionIds: ['save-plan'],
        items: [{ actionId: 'save-plan', text: '予定を保存しました。' }],
      })),
    };
    const planner = createAiBehaviorAwareWeeklyPlanningDialoguePlanner(config, client);

    const result = await planner.plan(input(value));

    expect(result.source).toBe('deterministic_fallback');
    expect(result.message).not.toContain('保存しました');
  });

  it('falls back on provider failure without changing allowed actions', async () => {
    const value = state(['英語ワークを進めたい']);
    const plannerInput = input(value);
    const before = JSON.stringify(plannerInput.allowedActions);
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };
    const planner = createAiBehaviorAwareWeeklyPlanningDialoguePlanner(config, client);

    const result = await planner.plan(plannerInput);

    expect(result.source).toBe('deterministic_fallback');
    expect(JSON.stringify(plannerInput.allowedActions)).toBe(before);
  });

  it('asks only for the learning content in the range-only fallback', async () => {
    const value = rangeOnlyState();
    const snapshot = createPlanningHypothesisSnapshot({
      state: value,
      currentUserText: '今日から日曜までの予定立てたい',
      conversationId: 'conversation-1',
    });
    const result = await createDeterministicBehaviorAwareDialoguePlanner().plan({
      snapshot,
      allowedActions: createAllowedDialogueActions(snapshot),
      acceptedFacts: {
        taskLabels: [],
        planningPeriodLabel: '今日から日曜まで',
        constraintSummary: [],
      },
      previewAllowed: false,
    });

    expect(result.message).toBe('具体的に何をどこまで進めたいか教えてください。');
    expect(result.renderedActionIds).toHaveLength(1);
    expect(result.message).not.toContain('ここまでの内容から');
    expect(result.message).not.toContain('無理のない進め方を整理します');
    expect(result.message).not.toContain('目安');
    expect(result.message).not.toContain('使える時間');
  });

  it('passes over a non-blocking deadline instead of asking on every turn', async () => {
    const value = state(['英語ワークを進めたい']);
    const result = await createDeterministicBehaviorAwareDialoguePlanner().plan(input(value));

    expect(result.message).toContain('仮の予定');
    expect(result.message).not.toContain('締切');
    expect(result.message).not.toContain('期限');
  });

  it('does not call or display AI-authored event claims for availability actions', async () => {
    const value = state(['英語ワークを進めたい']);
    value.fixedEventsDeclaredNone = undefined;
    value.missing = ['fixed_events'];
    const snapshot = createPlanningHypothesisSnapshot({ state: value });
    const allowedActions = [{
      actionId: 'ask-required-fixed-events',
      kind: 'ask_required_fact' as const,
      topicId: 'availability-basis',
      sourceFactRefs: [],
      allowedProposalRefs: [],
      allowedOptionIds: [],
      maxItems: 1,
      displayHint: 'availability-basis',
    }];
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => JSON.stringify({
        acknowledgement: '火曜の通院予定を確認しました。',
        selectedActionIds: [allowedActions[0]?.actionId],
        items: [{ actionId: allowedActions[0]?.actionId, text: '火曜の通院予定以外にありますか？' }],
      })),
    };
    const planner = createAiBehaviorAwareWeeklyPlanningDialoguePlanner(config, client);
    const result = await planner.plan({
      snapshot,
      allowedActions,
      acceptedFacts: {
        taskLabels: ['英語'],
        planningPeriodLabel: '今週',
        constraintSummary: [],
        knownFixedEventSummaries: ['7/16 13:00〜14:00「授業」'],
      },
      previewAllowed: false,
    });

    expect(client.createChatCompletion).not.toHaveBeenCalled();
    expect(result.source).toBe('deterministic_fallback');
    expect(result.message).toContain('7/16 13:00〜14:00「授業」');
    expect(result.message).not.toContain('通院');
  });

  it('uses a closed top-level response schema', () => {
    const schema = WEEKLY_PLANNING_BEHAVIOR_DIALOGUE_RESPONSE_FORMAT.json_schema.schema as any;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.items.items.additionalProperties).toBe(false);
  });
});
