import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { nextWeekScope } from '../intake/weeklyPlanningScopeParsing';
import { runLegacyWeeklyPlanningIntakePipelineForTests } from '../pipeline/weeklyPlanningLegacyIntakePipeline.testSupport';

describe('weekly planning week-start preference regression', () => {
  it('changes the next-week window according to the confirmed account setting', () => {
    expect(nextWeekScope({
      selectedDate: '2026-07-18',
      weekStartsOn: 'monday',
    })).toMatchObject({
      windowStartDate: '2026-07-20',
      windowEndDate: '2026-07-26',
    });

    expect(nextWeekScope({
      selectedDate: '2026-07-18',
      weekStartsOn: 'sunday',
    })).toMatchObject({
      windowStartDate: '2026-07-19',
      windowEndDate: '2026-07-25',
    });
  });

  it('passes the preference through the deterministic intake pipeline', () => {
    const previousState = {
      ...createInitialPlanningIntakeState(),
      lastQuestionContext: {
        kind: 'missing' as const,
        targetSlot: 'planning_period',
      },
    };
    const output = runLegacyWeeklyPlanningIntakePipelineForTests({
      previousState,
      userText: '来週',
      planningStartDate: '2026-07-18',
      planningDayCount: 7,
      currentDateTime: '2026-07-18T10:00:00',
      weekStartsOn: 'sunday',
    });

    expect(output.state.range).toMatchObject({
      startDateTime: '2026-07-19T00:00:00',
      endDateTime: '2026-07-25T24:00:00',
      calendarDayCount: 7,
    });
  });
});
