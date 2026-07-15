import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningIntakeInterpreter } from '../intake/weeklyPlanningInterpreterTypes';
import {
  runWeeklyPlanningBehaviorAwarePipeline,
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

async function initialState() {
  return runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
    ...baseInput,
    userText: '来週の予定立てたい',
    interpreter: emptyInterpreter,
  });
}

describe('weekly planning clarification context', () => {
  it('aligns an explicit term explanation with its answer example', async () => {
    const first = await initialState();
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...baseInput,
      previousState: first.state,
      userText: '固定の予定って何ですか？',
      interpreter: emptyInterpreter,
    });

    expect(output.decision.kind).toBe('answer_clarification');
    expect(output.decision.clarification?.targetSlot).toBe('fixed_events');
    expect(output.behaviorDialogue.message).toContain('「固定の予定」は');
    expect(output.behaviorDialogue.message).toContain('月曜日の18時から20時はバイトです');
    expect(output.behaviorDialogue.message).not.toContain('来週の月曜日から');
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
      interpreter: emptyInterpreter,
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

  it('supports the rules-only and provider-failure paths', async () => {
    const rulesFirst = await runWeeklyPlanningBehaviorAwarePipeline({
      ...baseInput,
      userText: '来週の予定立てたい',
    });
    const rulesOutput = await runWeeklyPlanningBehaviorAwarePipeline({
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
    expect(fallbackOutput.decision.kind).toBe('answer_clarification');
    expect(fallbackOutput.decision.clarification?.targetSlot)
      .toBe(first.state.lastQuestionContext?.targetSlot);
  });
});
