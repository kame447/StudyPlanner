import { describe, expect, it } from 'vitest';
import type {
  PlanningIntakeState,
  WeeklyPlanningIntakeContext,
} from './weeklyPlanningIntakeTypes';
import {
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from './weeklyPlanningIntakeReducer';
import { parseSetPlanningRangeCommand } from './weeklyPlanningScopeParsing';

const context: WeeklyPlanningIntakeContext = {
  selectedDate: '2026-07-17',
  currentDateTime: '2026-07-17T16:00:00',
};

function waitingForPlanningPeriod(): PlanningIntakeState {
  return {
    ...createInitialPlanningIntakeState(),
    status: 'needs_scope',
    intent: 'weekly_study_planning',
    missing: ['planning_period', 'tasks_or_goals'],
    lastQuestionContext: {
      kind: 'options',
      topicId: 'planning-range',
      actionId: 'show_options:planning-range:test',
      targetSlot: 'planning_period',
      intent: 'ask_planning_period',
    },
  };
}

describe('weekly planning period short-answer regression', () => {
  it.each([
    ['今週', '2026-07-17T16:00:00', '2026-07-19T24:00:00', 3],
    ['今週です', '2026-07-17T16:00:00', '2026-07-19T24:00:00', 3],
    ['今週でお願いします', '2026-07-17T16:00:00', '2026-07-19T24:00:00', 3],
    ['今週だって', '2026-07-17T16:00:00', '2026-07-19T24:00:00', 3],
    ['来週', '2026-07-20T00:00:00', '2026-07-26T24:00:00', 7],
    ['来週です', '2026-07-20T00:00:00', '2026-07-26T24:00:00', 7],
    ['来週でお願いします', '2026-07-20T00:00:00', '2026-07-26T24:00:00', 7],
    ['週末', '2026-07-18T00:00:00', '2026-07-19T24:00:00', 2],
    ['週末です', '2026-07-18T00:00:00', '2026-07-19T24:00:00', 2],
  ])(
    'accepts the rendered planning-period option %s',
    (text, startDateTime, endDateTime, calendarDayCount) => {
      const command = parseSetPlanningRangeCommand(
        text,
        context,
        undefined,
        'planning_period',
      );

      expect(command?.range).toMatchObject({
        startDateTime,
        endDateTime,
        calendarDayCount,
        confidence: 'explicit',
      });
    },
  );

  it.each([
    '今日から日曜日まで',
    '今日から次の日曜日までです',
    '日曜日まで',
  ])('accepts an explicit Sunday-bound short answer: %s', (text) => {
    const command = parseSetPlanningRangeCommand(
      text,
      context,
      undefined,
      'planning_period',
    );

    expect(command?.range).toMatchObject({
      startDateTime: '2026-07-17T16:00:00',
      endDateTime: '2026-07-19T24:00:00',
      calendarDayCount: 3,
      confidence: 'explicit',
    });
  });

  it('accepts the Sunday boundary in the initial planning request', () => {
    const state = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '日曜日までの予定を立てて',
      context,
    );

    expect(state.range).toMatchObject({
      startDateTime: '2026-07-17T16:00:00',
      endDateTime: '2026-07-19T24:00:00',
      calendarDayCount: 3,
    });
    expect(state.missing).not.toContain('planning_period');
  });

  it('applies 今週です after the planning-period question and advances the state', () => {
    const state = applyWeeklyPlanningUserTurn(
      waitingForPlanningPeriod(),
      '今週です',
      context,
    );

    expect(state.range).toMatchObject({
      startDateTime: '2026-07-17T16:00:00',
      endDateTime: '2026-07-19T24:00:00',
      calendarDayCount: 3,
    });
    expect(state.missing).not.toContain('planning_period');
  });

  it.each([
    '先生が「今週」と言っていました',
    '「来週です」という例文',
    '週末の予定についての教材',
  ])('does not adopt quoted, reported, or example text: %s', (text) => {
    expect(
      parseSetPlanningRangeCommand(
        text,
        context,
        undefined,
        'planning_period',
      ),
    ).toBeUndefined();
  });
});
