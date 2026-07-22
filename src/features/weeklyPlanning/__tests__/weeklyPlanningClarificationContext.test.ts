import { runLegacyWeeklyPlanningBehaviorAwarePipelineForTests } from '../pipeline/weeklyPlanningLegacyBehaviorAwareIntakePipeline.testSupport';
import { describe, expect, it } from 'vitest';
import type { ParsedWeeklyPlanningCommand } from '../intake/weeklyPlanningCommandTypes';
import type { WeeklyPlanningIntakeInterpreter } from '../intake/weeklyPlanningInterpreterTypes';
import {
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,
} from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';

const baseInput = {
  planningStartDate: '2026-07-15',
  planningDayCount: 7,
  currentDateTime: '2026-07-15T12:00:00',
};

const emptyInterpreter: WeeklyPlanningIntakeInterpreter = {
  async interpretUserTurn() {
    return { candidates: [], parseRejections: [] };
  },
};

function clarificationInterpreter(
  target: Extract<ParsedWeeklyPlanningCommand, { type: 'request_clarification' }>['target'],
  ref?: string,
): WeeklyPlanningIntakeInterpreter {
  return {
    async interpretUserTurn({ userText }) {
      return {
        candidates: [{
          command: {
            type: 'request_clarification',
            target,
            ...(ref ? { ref } : {}),
            sourceText: userText,
            confidence: 'high',
          },
          origin: 'ai_interpreter' as const,
          needsConfirmation: false,
        }],
        parseRejections: [],
      };
    },
  };
}

async function initialState() {
  return runLegacyWeeklyPlanningBehaviorAwarePipelineForTests({
    ...baseInput,
    userText: '来週の予定立てたい',
  });
}

describe('weekly planning clarification context', () => {
  it('aligns an explicit term explanation with its answer example', async () => {
    const first = await initialState();
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...baseInput,
      previousState: first.state,
      userText: '固定の予定って何ですか？',
      interpreter: clarificationInterpreter('referenced_term', 'fixed_events'),
    });

    expect(output.decision.kind).toBe('answer_clarification');
    expect(output.decision.clarification?.targetSlot).toBe('fixed_events');
    expect(output.behaviorDialogue.message).toContain('「固定の予定」は');
    expect(output.behaviorDialogue.message).toContain('土曜日の14時から16時は予定があります');
    expect(output.behaviorDialogue.message).not.toContain('来週の月曜日から');
  });

  it('explains the exact year-range wording from the observed conversation without repeating it', async () => {
    const first = await initialState();
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...baseInput,
      previousState: {
        ...first.state,
        lastQuestionContext: {
          kind: 'missing',
          targetSlot: 'year_range',
          intent: 'ask_year_range',
          topicId: 'task-identity',
        },
      },
      userText: '年度の計画ってどういうこと？',
      interpreter: clarificationInterpreter('referenced_term', 'year_range'),
    });

    expect(output.decision.kind).toBe('answer_clarification');
    expect(output.decision.clarification?.targetSlot).toBe('year_range');
    expect(output.behaviorDialogue.message).toContain('「対象年度」は');
    expect(output.behaviorDialogue.message).toContain('何年から何年までを対象にするか');
    expect(output.behaviorDialogue.message).not.toBe('対象年度は何年から何年までですか？');
  });

  it('uses a non-missing feasibility question as the clarification target', async () => {
    const first = await initialState();
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...baseInput,
      previousState: {
        ...first.state,
        lastQuestionContext: {
          kind: 'feasibility_adjustment',
          targetSlot: 'constraint_relaxation',
          intent: 'ask_constraint_relaxation',
          topicId: 'feasibility-adjustment',
        },
      },
      userText: 'よく分からない',
      interpreter: clarificationInterpreter('referenced_question'),
    });

    expect(output.decision.kind).toBe('answer_clarification');
    expect(output.decision.clarification?.targetSlot).toBe('constraint_relaxation');
    expect(output.behaviorDialogue.message).toContain('何を優先し、分割し、後へ回すか');
    expect(output.behaviorDialogue.message).toContain('英語を優先して、数学は翌日に回す');
  });

  it('does not infer an active question from missing state alone', async () => {
    const first = await initialState();
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...baseInput,
      previousState: { ...first.state, lastQuestionContext: undefined },
      userText: 'よく分からない',
      interpreter: emptyInterpreter,
    });

    expect(output.decision.kind).not.toBe('answer_clarification');
  });

  it('keeps rules-only behavior in test support and fails closed on provider failure', async () => {
    const rulesFirst = await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests({
      ...baseInput,
      userText: '来週の予定立てたい',
    });
    const rulesOutput = await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests({
      ...baseInput,
      previousState: rulesFirst.state,
      userText: 'よく分からない',
    });
    expect(rulesOutput.decision.kind).toBe('answer_clarification');

    const first = await initialState();
    const failingInterpreter: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn() {
        throw new Error('provider unavailable');
      },
    };
    const fallbackOutput = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...baseInput,
      previousState: first.state,
      userText: 'よく分からない',
      interpreter: failingInterpreter,
    });
    expect(fallbackOutput.interpretationOutcome).toBe('failed');
    expect(fallbackOutput.stateMutationSource).toBe('none');
    expect(fallbackOutput.behaviorDialogue.source).toBe('system');
    expect(fallbackOutput.decision.kind).not.toBe('answer_clarification');
  });
});
