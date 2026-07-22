import { describe, expect, it } from 'vitest';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import { applyWeeklyPlanningCommands, createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type { InterpretedCommandCandidate } from '../intake/weeklyPlanningInterpreterTypes';
import type { SetStudyGoalCommand } from '../intake/weeklyPlanningCommandTypes';
import { deriveTaskExecutionProfiles } from '../planning/weeklyPlanningBehaviorPlanner';

const context = {
  selectedDate: '2026-07-20',
  currentDateTime: '2026-07-21T12:00:00',
};

function command(overrides: Partial<SetStudyGoalCommand['goal']>): SetStudyGoalCommand {
  return {
    type: 'set_study_goal',
    goal: {
      title: 'ワーク',
      subject: '英語',
      unit: 'minutes',
      amount: 30,
      executionProfile: {
        activityKind: 'drill',
        distributionPolicy: 'sequential_units',
        cognitiveLoad: 'medium',
      },
      ...overrides,
    },
    sourceText: '英語のワークを30分やる',
    confidence: 'high',
  };
}

function candidate(value: SetStudyGoalCommand): InterpretedCommandCandidate {
  return {
    command: value,
    origin: 'ai_interpreter',
    needsConfirmation: false,
  };
}

describe('typed task execution profile ownership', () => {
  it('uses the AI typed execution profile without reclassifying task text', () => {
    const state = applyWeeklyPlanningCommands(
      createInitialPlanningIntakeState(),
      [command({})],
    );

    expect(state.tasks[0].executionProfile).toEqual({
      activityKind: 'drill',
      distributionPolicy: 'sequential_units',
      cognitiveLoad: 'medium',
    });
    expect(deriveTaskExecutionProfiles(state)[0]).toMatchObject({
      activityKind: 'drill',
      distributionPolicy: 'sequential_units',
      cognitiveLoad: 'medium',
      minSessionMinutes: 30,
      targetSessionMinutes: 60,
      maxSessionMinutes: 90,
      origin: 'ai_interpreted',
    });
  });

  it('does not infer memorization from a task title when AI omitted the profile', () => {
    const value = command({
      title: '英単語',
      subject: '英語',
      executionProfile: undefined,
    });
    const state = applyWeeklyPlanningCommands(createInitialPlanningIntakeState(), [value]);

    expect(deriveTaskExecutionProfiles(state)[0]).toMatchObject({
      activityKind: 'unknown',
      cognitiveLoad: 'unknown',
      origin: 'deterministic_derived',
    });
  });

  it('keeps same-title tasks distinct when subjects differ', () => {
    const english = command({ subject: '英語' });
    const math = {
      ...command({ subject: '数学', amount: 60 }),
      sourceText: '数学のワークを60分やる',
    };
    const validation = validateInterpretedCandidates(
      [candidate(english), candidate(math)],
      { knownFields: [], confirmedSlots: [] },
      context,
    );

    expect(validation.accepted).toHaveLength(2);
    const state = applyWeeklyPlanningCommands(
      createInitialPlanningIntakeState(),
      validation.accepted,
    );
    expect(state.tasks.map((task) => [task.title, task.subject])).toEqual([
      ['ワーク', '英語'],
      ['ワーク', '数学'],
    ]);
  });
});
