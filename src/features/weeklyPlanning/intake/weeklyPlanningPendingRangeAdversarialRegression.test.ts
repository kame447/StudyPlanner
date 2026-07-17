import { describe, expect, it } from 'vitest';
import { validateInterpretedCandidates } from './weeklyPlanningCandidateValidator';
import { normalizeSetPendingPlanningRangeCommand } from './weeklyPlanningCommandAdapter';
import type { SetPendingPlanningRangeCommand } from './weeklyPlanningCommandTypes';
import { createInitialPlanningIntakeState } from './weeklyPlanningIntakeReducer';
import { finalizeState } from './weeklyPlanningMissingStatus';
import {
  parseSetPendingPlanningRangeCommand,
  parseSetPlanningRangeCommand,
} from './weeklyPlanningScopeParsing';

const selectedDateContext = {
  selectedDate: '2026-06-26',
  currentDateTime: '2026-07-16T12:00:00',
};

const nextWeekPending = {
  scope: {
    kind: 'next_week' as const,
    label: '来週',
    windowStartDate: '2026-06-29',
    windowEndDate: '2026-07-05',
  },
  durationDays: 7,
  sourceText: '来週の予定を立てたい',
};

function aiNextWeekCommand(): SetPendingPlanningRangeCommand {
  return {
    type: 'set_pending_planning_range',
    pending: {
      scope: { kind: 'next_week', label: '来週' },
      sourceText: '来週の予定を立てたい',
    },
    sourceText: '来週の予定を立てたい',
    confidence: 'high',
  };
}

describe('pending range adversarial regression', () => {
  it('normalizes an AI next-week payload from selectedDate, not currentDateTime', () => {
    const normalized = normalizeSetPendingPlanningRangeCommand(
      aiNextWeekCommand(),
      selectedDateContext,
    );

    expect(normalized.pending.scope).toEqual({
      kind: 'next_week',
      label: '来週',
      windowStartDate: '2026-06-29',
      windowEndDate: '2026-07-05',
    });
    expect(normalized.pending.durationDays).toBe(7);
  });

  it('accepts an AI next-week payload before adapter window completion', () => {
    const command = aiNextWeekCommand();
    const result = validateInterpretedCandidates([
      {
        command,
        origin: 'ai_interpreter',
        needsConfirmation: false,
      },
    ], {
      knownFields: [],
      confirmedSlots: [],
    });

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toEqual([command]);
  });

  it.each([
    '八月一日から一週間',
    '8月一日から',
    '八月1日から',
  ])('does not reinterpret a kanji absolute date as an in-window weekday: %s', (text) => {
    expect(parseSetPlanningRangeCommand(
      text,
      selectedDateContext,
      nextWeekPending,
      'planning_start_date',
    )).toBeUndefined();
    expect(parseSetPendingPlanningRangeCommand(
      text,
      selectedDateContext,
      {
        pending: nextWeekPending,
        expectedSlot: 'planning_start_date',
      },
    )).toBeUndefined();
  });

  it('accepts a kanji absolute date as the selected start of an unbounded named period', () => {
    const command = parseSetPendingPlanningRangeCommand(
      '八月一日から',
      selectedDateContext,
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

  it('does not interpret a third-party hope statement as the user switching periods', () => {
    expect(parseSetPendingPlanningRangeCommand(
      '第三者の希望は夏休みではなく来週の計画です',
      selectedDateContext,
    )).toBeUndefined();
  });

  it('hides only duration while start is missing and keeps unrelated questions visible', () => {
    const state = finalizeState({
      ...createInitialPlanningIntakeState(),
      missing: [
        'planning_start_date',
        'planning_duration',
        'tasks_or_goals',
        'year_range',
      ],
    });

    expect(state.questions).toContain('その期間のどの日から計画を始めますか？');
    expect(state.questions).not.toContain('その期間の計画は、開始日から何日間にしますか？');
    expect(state.questions).toContain('計画したい学習内容や目標を教えてください。');
    expect(state.questions).toContain('7年分は何年から何年までですか？');
  });
});
