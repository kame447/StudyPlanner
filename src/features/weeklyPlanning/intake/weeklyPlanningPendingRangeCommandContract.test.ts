import { describe, expect, it } from 'vitest';
import { normalizeSetPendingPlanningRangeCommand } from './weeklyPlanningCommandAdapter';
import { applyWeeklyPlanningUserTurn } from './weeklyPlanningIntakeReducer';
import {
  canonicalizeOptionalCommandNulls,
  isValidWeeklyPlanningCommand,
} from './weeklyPlanningCommandRuntimeValidation';
import type { SetPendingPlanningRangeCommand } from './weeklyPlanningCommandTypes';
import {
  parseSetPendingPlanningRangeCommand,
  parseSetPlanningRangeCommand,
} from './weeklyPlanningScopeParsing';

function commandWithoutDuration(
  kind: 'next_week' | 'named_future_period' = 'next_week',
): SetPendingPlanningRangeCommand {
  return {
    type: 'set_pending_planning_range',
    pending: {
      scope: { kind, label: kind === 'next_week' ? '来週' : '次の期間' },
      sourceText: '来週の予定を立てたい',
    },
    sourceText: '来週の予定を立てたい',
    confidence: 'high',
  };
}

const summerPending = {
  scope: {
    kind: 'named_future_period' as const,
    label: '夏休み',
    windowStartDate: '2026-07-20',
    windowEndDate: '2026-08-31',
  },
  sourceText: '夏休みに計画を立てたい',
};

describe('pending planning range command contract', () => {
  it('accepts an omitted AI payload duration and normalizes it into required next-week domain state', () => {
    const command = commandWithoutDuration();
    expect(isValidWeeklyPlanningCommand(command)).toBe(true);

    const normalized = normalizeSetPendingPlanningRangeCommand(command, {
      selectedDate: '2026-07-16',
      currentDateTime: '2026-07-16T12:00:00',
    });

    expect(normalized.pending.durationDays).toBe(7);
    expect(normalized.pending.scope.windowStartDate).toBeDefined();
    expect(normalized.pending.scope.windowEndDate).toBeDefined();
  });

  it('preserves a named future period without inferring window, start, or duration', () => {
    const command = commandWithoutDuration('named_future_period');
    const normalized = normalizeSetPendingPlanningRangeCommand(
      command,
      { selectedDate: '2026-07-16' },
    );
    expect(normalized.pending).toEqual(command.pending);
  });

  it('preserves an explicit named-future duration', () => {
    const command = commandWithoutDuration('named_future_period');
    const normalized = normalizeSetPendingPlanningRangeCommand({
      ...command,
      pending: { ...command.pending, durationDays: 14 },
    }, { selectedDate: '2026-07-16' });
    expect(normalized.pending.durationDays).toBe(14);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid optional durationDays: %s',
    (durationDays) => {
      expect(isValidWeeklyPlanningCommand({
        ...commandWithoutDuration(),
        pending: { ...commandWithoutDuration().pending, durationDays },
      })).toBe(false);
    },
  );

  it('rejects planning scope kinds outside the closed union', () => {
    expect(isValidWeeklyPlanningCommand({
      ...commandWithoutDuration(),
      pending: {
        ...commandWithoutDuration().pending,
        scope: { kind: 'invalid', label: '不正' },
      },
    })).toBe(false);
  });

  it('canonicalizes null optional pending values', () => {
    const canonicalized = canonicalizeOptionalCommandNulls({
      ...commandWithoutDuration(),
      pending: {
        ...commandWithoutDuration().pending,
        planningStartDate: null,
        durationDays: null,
        scope: {
          ...commandWithoutDuration().pending.scope,
          windowStartDate: null,
          windowEndDate: null,
        },
      },
    }) as SetPendingPlanningRangeCommand;

    expect(canonicalized.pending.planningStartDate).toBeUndefined();
    expect(canonicalized.pending.durationDays).toBeUndefined();
    expect(canonicalized.pending.scope.windowStartDate).toBeUndefined();
    expect(canonicalized.pending.scope.windowEndDate).toBeUndefined();
  });

  it('rejects a fully resolved pending value', () => {
    expect(isValidWeeklyPlanningCommand({
      ...commandWithoutDuration('named_future_period'),
      pending: {
        ...summerPending,
        planningStartDate: '2026-08-01',
        durationDays: 7,
      },
    })).toBe(false);
  });

  it('rejects invalid or out-of-window selected start dates', () => {
    expect(isValidWeeklyPlanningCommand({
      ...commandWithoutDuration('named_future_period'),
      pending: { ...summerPending, planningStartDate: '2026-02-30' },
    })).toBe(false);
    expect(isValidWeeklyPlanningCommand({
      ...commandWithoutDuration('named_future_period'),
      pending: { ...summerPending, planningStartDate: '2026-10-01' },
    })).toBe(false);
  });

  it('parses a bare duration against pending state and preserves the selected start', () => {
    const command = parseSetPendingPlanningRangeCommand(
      '一週間',
      { selectedDate: '2026-07-16' },
      {
        pending: { ...summerPending, planningStartDate: '2026-08-01' },
        expectedSlot: 'planning_duration',
      },
    );

    expect(command?.pending).toMatchObject({
      planningStartDate: '2026-08-01',
      durationDays: 7,
    });
  });

  it('promotes pending state when the missing answer is supplied', () => {
    const startThenDuration = parseSetPlanningRangeCommand(
      '一週間',
      { selectedDate: '2026-07-16' },
      { ...summerPending, planningStartDate: '2026-08-01' },
      'planning_duration',
    );
    const durationThenStart = parseSetPlanningRangeCommand(
      '8月1日から',
      { selectedDate: '2026-07-16' },
      { ...summerPending, durationDays: 7 },
      'planning_start_date',
    );

    expect(startThenDuration?.range).toEqual(durationThenStart?.range);
    expect(startThenDuration?.range.startDateTime).toBe('2026-08-01T00:00:00');
    expect(startThenDuration?.range.endDateTime).toBe('2026-08-07T24:00:00');
  });

  it('does not generate a NaN range from an excessive stored duration', () => {
    expect(parseSetPlanningRangeCommand(
      '8月1日から',
      { selectedDate: '2026-07-16' },
      {
        ...summerPending,
        durationDays: Number.MAX_SAFE_INTEGER,
      },
      'planning_start_date',
    )).toBeUndefined();
  });

  it('keeps the established next-week pending regression cases', () => {
    const nextWeek = parseSetPendingPlanningRangeCommand(
      '来週の予定を立てたい',
      { selectedDate: '2026-07-16' },
    );
    expect(nextWeek?.pending.scope.kind).toBe('next_week');

    const state = applyWeeklyPlanningUserTurn(undefined, '来週の予定を立てたい', {
      selectedDate: '2026-07-16',
    });
    const afterSummerAnswer = applyWeeklyPlanningUserTurn(state, '夏休み', {
      selectedDate: '2026-07-16',
    });
    expect(afterSummerAnswer.pendingPlanningRange?.scope.kind).toBe('next_week');

    const outsideDate = parseSetPendingPlanningRangeCommand(
      '8月1日から',
      { selectedDate: '2026-07-16' },
      {
        pending: nextWeek?.pending,
        expectedSlot: 'planning_start_date',
      },
    );
    expect(outsideDate).toBeUndefined();
  });

  it('does not create a planning range from summer homework content', () => {
    expect(parseSetPlanningRangeCommand(
      '夏休みの宿題は数学ワーク10ページです',
      { selectedDate: '2026-07-16' },
    )).toBeUndefined();
  });
});
