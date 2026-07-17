import { describe, expect, it } from 'vitest';
import {
  parseSetPendingPlanningRangeCommand,
  parseSetPlanningRangeCommand,
} from '../intake/weeklyPlanningScopeParsing';
import { runWeeklyPlanningIntakePipeline } from './weeklyPlanningIntakePipeline';

const context = {
  selectedDate: '2026-07-17',
  currentDateTime: '2026-07-17T12:00:00',
};

function runTurn(
  previousState: Parameters<typeof runWeeklyPlanningIntakePipeline>[0]['previousState'],
  userText: string,
) {
  return runWeeklyPlanningIntakePipeline({
    previousState,
    userText,
    planningStartDate: context.selectedDate,
    planningDayCount: 7,
    currentDateTime: context.currentDateTime,
  });
}

function beginSummerPlanning() {
  return runTurn(undefined, '夏休みに計画を立てたい');
}

describe('pending planning range contract', () => {
  it('stores the selected start date and asks only for duration next', () => {
    const first = beginSummerPlanning();
    const second = runTurn(first.state, '8月1日から');

    expect(second.state.pendingPlanningRange?.planningStartDate).toBe('2026-08-01');
    expect(second.state.pendingPlanningRange?.durationDays).toBeUndefined();
    expect(second.state.missing).toContain('planning_duration');
    expect(second.state.missing).not.toContain('planning_start_date');
    expect(second.state.questions).toContain(
      '夏休みの計画は、開始日から何日間にしますか？',
    );
    expect(second.state.questions).not.toContain(
      '夏休みの計画は、いつから始めますか？',
    );
    expect(second.state.lastQuestionContext?.targetSlot).toBe('planning_duration');
  });

  it('stores duration and asks only for the selected start date next', () => {
    const first = beginSummerPlanning();
    const second = runTurn(first.state, '一週間');

    expect(second.state.pendingPlanningRange?.durationDays).toBe(7);
    expect(second.state.pendingPlanningRange?.planningStartDate).toBeUndefined();
    expect(second.state.missing).toContain('planning_start_date');
    expect(second.state.missing).not.toContain('planning_duration');
    expect(second.state.questions).toContain(
      '夏休みの計画は、いつから始めますか？',
    );
    expect(second.state.lastQuestionContext?.targetSlot).toBe('planning_start_date');
  });

  it('promotes start then duration into the same concrete range', () => {
    const first = beginSummerPlanning();
    const second = runTurn(first.state, '8月1日から');
    const third = runTurn(second.state, '一週間');

    expect(third.state.range?.startDateTime).toBe('2026-08-01T00:00:00');
    expect(third.state.range?.endDateTime).toBe('2026-08-07T24:00:00');
    expect(third.state.pendingPlanningRange).toBeUndefined();
  });

  it('promotes duration then start into the same concrete range', () => {
    const first = beginSummerPlanning();
    const second = runTurn(first.state, '一週間');
    const third = runTurn(second.state, '8月1日から');

    expect(third.state.range?.startDateTime).toBe('2026-08-01T00:00:00');
    expect(third.state.range?.endDateTime).toBe('2026-08-07T24:00:00');
    expect(third.state.pendingPlanningRange).toBeUndefined();
  });

  it('does not use the selectable window start as a selected start date', () => {
    expect(parseSetPlanningRangeCommand(
      '一週間',
      context,
      {
        scope: {
          kind: 'named_future_period',
          label: '夏休み',
          windowStartDate: '2026-07-20',
          windowEndDate: '2026-08-31',
        },
        sourceText: '夏休みに計画を立てたい',
      },
      'planning_start_date',
    )).toBeUndefined();
  });

  it('rejects a selected start date outside the named period window', () => {
    expect(parseSetPendingPlanningRangeCommand(
      '10月1日から',
      context,
      {
        pending: {
          scope: {
            kind: 'named_future_period',
            label: '夏休み',
            windowStartDate: '2026-07-20',
            windowEndDate: '2026-08-31',
          },
          sourceText: '夏休みに計画を立てたい',
        },
        expectedSlot: 'planning_start_date',
      },
    )).toBeUndefined();
  });

  it.each([
    '先生が「夏休みじゃなくて来週にしたい」と言っていました',
    '母が夏休みじゃなくて来週にしたいそうです',
    '学習内容として「夏休みじゃなくて来週にしたい」という文を読みました',
    '第三者の希望は夏休みではなく来週の計画です',
    '例文では夏休みじゃなくて来週にしたいと書いてあります',
  ])('does not treat quoted, reported, learning, third-party, or example text as a switch: %s', (text) => {
    expect(parseSetPendingPlanningRangeCommand(text, context)).toBeUndefined();
  });

  it.each([
    '夏休みじゃなくて来週にしたい',
    '夏休みではなく来週の計画を立てたい',
  ])('keeps a direct period switch: %s', (text) => {
    expect(parseSetPendingPlanningRangeCommand(text, context)?.pending.scope.kind)
      .toBe('next_week');
  });

  it('does not adopt a task deadline as the planning start', () => {
    const first = beginSummerPlanning();
    const second = runTurn(first.state, '数学ワークの提出日は8月1日からです');

    expect(second.state.pendingPlanningRange?.planningStartDate).toBeUndefined();
  });

  it('does not adopt a task work duration as planning duration', () => {
    const first = beginSummerPlanning();
    const second = runTurn(first.state, '数学ワークは一週間で終わらせたい');

    expect(second.state.pendingPlanningRange?.durationDays).toBeUndefined();
  });

  it.each(['8月1日から', '8月1日'])('keeps accepted short start answers: %s', (text) => {
    const command = parseSetPendingPlanningRangeCommand(
      text,
      context,
      {
        pending: {
          scope: { kind: 'named_future_period', label: '夏休み' },
          sourceText: '夏休みに計画を立てたい',
        },
        expectedSlot: 'planning_start_date',
      },
    );
    expect(command?.pending.planningStartDate).toBe('2026-08-01');
  });

  it.each(['一週間', '1週間', '7日', '7日間'])('keeps accepted short duration answers: %s', (text) => {
    const command = parseSetPendingPlanningRangeCommand(
      text,
      context,
      {
        pending: {
          scope: { kind: 'named_future_period', label: '夏休み' },
          sourceText: '夏休みに計画を立てたい',
        },
        expectedSlot: 'planning_duration',
      },
    );
    expect(command?.pending.durationDays).toBe(7);
  });
});
