import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import type { WeeklyPlanningIntakeInterpreter } from '../intake/weeklyPlanningInterpreterTypes';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { runWeeklyPlanningIntakePipelineWithInterpreter } from './weeklyPlanningIntakePipeline';

function plan(id: string, date: string): Plan {
  return {
    id, seriesId: id, userId: 'user', date, startTime: '10:00', endTime: '11:00', title: id,
    subject: '', type: 'other', memo: '', repeat: 'none', repeatUntil: null,
    recurrenceRules: [], excludedDates: [], createdAt: '', updatedAt: '',
  } as Plan;
}

function previousState() {
  return {
    ...createInitialPlanningIntakeState(),
    range: {
      startDateTime: '2026-07-16T12:00:00',
      endDateTime: '2026-07-19T18:00:00',
      confidence: 'explicit' as const,
      sourceText: '今週',
    },
  };
}

describe('fixed event source availability', () => {
  it('does not expose existing_plans when every plan is outside the active range', async () => {
    let available = true;
    const interpreter: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn(input) {
        available = input.stateSummary.availableConstraintSources?.existingPlans ?? false;
        return { candidates: [], parseRejections: [] };
      },
    };
    await runWeeklyPlanningIntakePipelineWithInterpreter({
      previousState: previousState(), userText: '予定を使って', planningStartDate: '2026-07-16',
      planningDayCount: 4, existingPlans: [plan('outside', '2026-07-20')], interpreter,
    });
    expect(available).toBe(false);
  });

  it('exposes existing_plans when a recurring occurrence overlaps the active range', async () => {
    let available = false;
    const interpreter: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn(input) {
        available = input.stateSummary.availableConstraintSources?.existingPlans ?? false;
        return { candidates: [], parseRejections: [] };
      },
    };
    const recurring = {
      ...plan('weekly', '2026-07-09'),
      startTime: '14:00',
      endTime: '15:00',
      repeat: 'weekly' as const,
      repeatUntil: '2026-08-31',
    };
    await runWeeklyPlanningIntakePipelineWithInterpreter({
      previousState: previousState(), userText: '予定を使って', planningStartDate: '2026-07-16',
      planningDayCount: 4, existingPlans: [recurring], interpreter,
    });
    expect(available).toBe(true);
  });
});
