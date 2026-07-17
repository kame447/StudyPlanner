import { describe, expect, it } from 'vitest';
import type {
  PlanningIntakeState,
  WeeklyPlanningIntakeContext,
} from './weeklyPlanningIntakeTypes';
import {
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from './weeklyPlanningIntakeReducer';
import {
  parseSetPendingPlanningRangeCommand,
  parseSetPlanningRangeCommand,
} from './weeklyPlanningScopeParsing';

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

function sundayPending(): PlanningIntakeState {
  return applyWeeklyPlanningUserTurn(
    createInitialPlanningIntakeState(),
    '日曜日までの予定立てて',
    context,
  );
}

function expectSundayRange(
  state: PlanningIntakeState,
  startDateTime: string,
): void {
  expect(state.range).toMatchObject({
    startDateTime,
    endDateTime: '2026-07-19T24:00:00',
    calendarDayCount: 3,
    confidence: 'explicit',
  });
  expect(state.pendingPlanningRange).toBeUndefined();
  expect(state.missing).not.toContain('planning_period');
  expect(state.missing).not.toContain('planning_start_date');
  expect(state.missing).not.toContain('planning_duration');
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

  it('keeps only the Sunday end boundary pending on the initial request', () => {
    const state = sundayPending();

    expect(state.range).toBeUndefined();
    expect(state.pendingPlanningRange).toMatchObject({
      scope: {
        label: '日曜日まで',
        windowEndDate: '2026-07-19',
      },
      planningEndDateTime: '2026-07-19T24:00:00',
    });
    expect(state.pendingPlanningRange?.planningStartDate).toBeUndefined();
    expect(state.missing).toContain('planning_start_date');
    expect(state.missing).not.toContain('planning_period');
    expect(state.missing).not.toContain('planning_duration');
    expect(state.questions).toContain(
      '日曜日までの終了時刻より前のいつから計画を始めますか？',
    );
  });

  it.each([
    ['今すぐ', '2026-07-17T16:00:00'],
    ['すぐ', '2026-07-17T16:00:00'],
    ['1時間後', '2026-07-17T17:00:00'],
    ['30分後', '2026-07-17T16:30:00'],
    ['今日の20時から', '2026-07-17T20:00:00'],
    ['今日20時', '2026-07-17T20:00:00'],
    ['明日', '2026-07-18T00:00:00'],
    ['明日から', '2026-07-18T00:00:00'],
    ['明日の朝から', '2026-07-18T08:00:00'],
    ['明日の14時から', '2026-07-18T14:00:00'],
    ['7月18日から', '2026-07-18T00:00:00'],
    ['7月18日の14時から', '2026-07-18T14:00:00'],
    ['土曜日から', '2026-07-18T00:00:00'],
    ['土曜日の昼から', '2026-07-18T12:00:00'],
  ])(
    'promotes an arbitrary start answer %s',
    (text, startDateTime) => {
      const state = applyWeeklyPlanningUserTurn(sundayPending(), text, context);
      expectSundayRange(state, startDateTime);
    },
  );

  it.each([
    ['今日の20時から日曜日まで', '2026-07-17T20:00:00'],
    ['1時間後から日曜日まで', '2026-07-17T17:00:00'],
    ['明日から日曜日まで', '2026-07-18T00:00:00'],
    ['7月18日14時から日曜日まで', '2026-07-18T14:00:00'],
  ])(
    'creates a complete range when start and Sunday end are in one turn: %s',
    (text, startDateTime) => {
      const state = applyWeeklyPlanningUserTurn(
        createInitialPlanningIntakeState(),
        text,
        context,
      );
      expectSundayRange(state, startDateTime);
    },
  );

  it('keeps the Sunday end pending when the proposed start is after it', () => {
    const state = applyWeeklyPlanningUserTurn(sundayPending(), '月曜日から', context);

    expect(state.range).toBeUndefined();
    expect(state.pendingPlanningRange).toMatchObject({
      scope: { windowEndDate: '2026-07-19' },
      planningEndDateTime: '2026-07-19T24:00:00',
    });
    expect(state.missing).toContain('planning_start_date');
    expect(state.missing).not.toContain('planning_duration');
    expect(state.questions).toContain(
      '日曜日までの終了時刻より前のいつから計画を始めますか？',
    );
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
    '先生が「日曜日まで」と言っていました',
    '「日曜日まで」という例文',
    '日曜日までという表現の意味を教えて',
  ])('does not adopt quoted, reported, or explanation text: %s', (text) => {
    const state = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      text,
      context,
    );

    expect(state.range).toBeUndefined();
    expect(state.pendingPlanningRange).toBeUndefined();
  });

  it('does not treat a bare Sunday answer as a complete range', () => {
    expect(parseSetPlanningRangeCommand(
      '日曜日まで',
      context,
      undefined,
      'planning_period',
    )).toBeUndefined();

    const command = parseSetPendingPlanningRangeCommand(
      '日曜日まで',
      context,
      { expectedSlot: 'planning_period' },
    );
    expect(command?.pending).toMatchObject({
      scope: { windowEndDate: '2026-07-19' },
      planningEndDateTime: '2026-07-19T24:00:00',
    });
  });
});
