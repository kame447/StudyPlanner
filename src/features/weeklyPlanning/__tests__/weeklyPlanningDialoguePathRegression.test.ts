import { describe, expect, it } from 'vitest';
import type {
  WeeklyPlanningIntakeInterpreter,
  WeeklyPlanningInterpreterResult,
} from '../intake/weeklyPlanningInterpreterTypes';
import {
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,
} from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';

function interpreterResult(userText: string): WeeklyPlanningInterpreterResult {
  if (userText === 'どういうこと？') {
    return {
      candidates: [{
        command: {
          type: 'request_clarification',
          target: 'referenced_question',
          ref: 'planning_start_date',
          sourceText: userText,
          confidence: 'high',
        },
        origin: 'ai_interpreter',
        needsConfirmation: false,
      }],
      parseRejections: [],
    };
  }

  return {
    candidates: [{
      command: {
        type: 'begin_weekly_planning',
        sourceText: userText,
        confidence: 'high',
      },
      origin: 'ai_interpreter',
      needsConfirmation: false,
    }],
    parseRejections: [],
  };
}

function createInterpreter(): WeeklyPlanningIntakeInterpreter {
  return {
    async interpretUserTurn({ userText }) {
      return interpreterResult(userText);
    },
  };
}

const baseInput = {
  planningStartDate: '2026-07-15',
  planningDayCount: 7,
  currentDateTime: '2026-07-15T12:00:00',
};

describe('weekly planning dialogue path regressions', () => {
  it('keeps the deterministic next-week range when the AI returns only begin_weekly_planning', async () => {
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...baseInput,
      userText: '来週の予定立てたい',
      interpreter: createInterpreter(),
    });

    expect(output.state.pendingPlanningRange?.scope.label).toBe('来週');
    expect(output.state.missing).toEqual(expect.arrayContaining([
      'planning_start_date',
      'tasks_or_goals',
    ]));
    expect(output.behavior.actions.map((action) => action.topicId)).toEqual(expect.arrayContaining([
      'planning-range',
      'task-identity',
    ]));
    expect(output.behavior.actions.some((action) => action.actionId.startsWith('feasibility:'))).toBe(false);
    expect(output.behaviorDialogue.message).toContain('来週のどの日から計画を始めますか？');
    expect(output.behaviorDialogue.message).toContain('具体的に何をどこまで進めたいか教えてください。');
    expect(output.behaviorDialogue.message).not.toContain('使える時間は');
  });

  it('explains the previous question instead of regenerating the same fallback on clarification', async () => {
    const interpreter = createInterpreter();
    const first = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...baseInput,
      userText: '来週の予定立てたい',
      interpreter,
    });
    const clarified = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...baseInput,
      previousState: first.state,
      userText: 'どういうこと？',
      interpreter,
    });

    expect(clarified.decision.kind).toBe('answer_clarification');
    expect(clarified.behaviorDialogue.message).toContain('計画を始める日です。');
    expect(clarified.behaviorDialogue.message).toContain('例えば「来週の月曜日から」');
    expect(clarified.behaviorDialogue.message).not.toBe(first.behaviorDialogue.message);
    expect(clarified.behaviorDialogue.message).not.toContain('使える時間は');
  });
});
