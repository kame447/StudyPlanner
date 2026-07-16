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

describe('pending planning range command contract', () => {
  it('accepts an omitted AI payload duration and normalizes it into required domain state', () => {
    const command = commandWithoutDuration();
    expect(isValidWeeklyPlanningCommand(command)).toBe(true);

    const normalized = normalizeSetPendingPlanningRangeCommand(command, {
      selectedDate: '2026-07-16',
      currentDateTime: '2026-07-16T12:00:00',
    });

    expect(normalized.pending.durationDays).toBe(7);
    expect(normalized.pending.scope.startDate).toBeDefined();
    expect(normalized.pending.scope.endDate).toBeDefined();
  });

  it('preserves a named future period without inferring dates or duration', () => {
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

  it.each([0, -1, 1.5])('rejects invalid optional durationDays: %s', (durationDays) => {
    expect(isValidWeeklyPlanningCommand({
      ...commandWithoutDuration(),
      pending: { ...commandWithoutDuration().pending, durationDays },
    })).toBe(false);
  });

  it('rejects planning scope kinds outside the closed union', () => {
    expect(isValidWeeklyPlanningCommand({
      ...commandWithoutDuration(),
      pending: {
        ...commandWithoutDuration().pending,
        scope: { kind: 'invalid', label: '不正' },
      },
    })).toBe(false);
  });

  it('canonicalizes null durationDays to the optional AI payload shape', () => {
    const canonicalized = canonicalizeOptionalCommandNulls({
      ...commandWithoutDuration(),
      pending: { ...commandWithoutDuration().pending, durationDays: null },
    });
    expect(isValidWeeklyPlanningCommand(canonicalized)).toBe(true);
  });

  it('keeps the one-week duration from a named future period and resolves a later date', () => {
    const context = {
      selectedDate: '2026-07-16',
      currentDateTime: '2026-07-16T12:00:00',
    };
    const pending = parseSetPendingPlanningRangeCommand(
      '夏休みの一週間で計画を立てたい',
      context,
    );
    expect(pending?.pending).toMatchObject({
      scope: { kind: 'named_future_period', label: '夏休み' },
      durationDays: 7,
    });

    const resolved = parseSetPlanningRangeCommand(
      '8月1日から',
      context,
      pending?.pending,
    );
    expect(resolved?.range).toMatchObject({
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      calendarDayCount: 7,
      confidence: 'explicit',
    });
  });

  it('keeps a duration-less named future period from the initial utterance and resolves it later', () => {
    const context = {
      selectedDate: '2026-07-16',
      currentDateTime: '2026-07-16T12:00:00',
    };
    const pending = parseSetPendingPlanningRangeCommand(
      '夏休みに計画を立てたい',
      context,
    );
    expect(pending?.pending).toEqual({
      scope: { kind: 'named_future_period', label: '夏休み' },
      sourceText: '夏休みに計画を立てたい',
    });

    const resolved = parseSetPlanningRangeCommand(
      '8月1日から一週間',
      context,
      pending?.pending,
    );
    expect(resolved?.range).toMatchObject({
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      calendarDayCount: 7,
    });
  });

  it.each([
    '8月1日から一週間',
    '8月1 日から一週間',
    '９月１０ 日から一週間',
  ])('does not reinterpret an out-of-window explicit date as a weekday: %s', (text) => {
    const context = {
      selectedDate: '2026-06-26',
      currentDateTime: '2026-06-26T12:00:00',
    };
    const pending = parseSetPendingPlanningRangeCommand(
      '来週の予定を立てたい',
      context,
    );
    expect(pending?.pending.scope).toMatchObject({
      kind: 'next_week',
      startDate: '2026-06-29',
      endDate: '2026-07-05',
    });

    const resolved = parseSetPlanningRangeCommand(text, context, pending?.pending);
    expect(resolved).toBeUndefined();
  });

  it.each([
    ['日曜から', '2026-07-05T00:00:00'],
    ['日曜日から', '2026-07-05T00:00:00'],
    ['月曜から', '2026-06-29T00:00:00'],
  ])('continues to resolve a real weekday answer: %s', (text, startDateTime) => {
    const context = {
      selectedDate: '2026-06-26',
      currentDateTime: '2026-06-26T12:00:00',
    };
    const pending = parseSetPendingPlanningRangeCommand('来週の予定を立てたい', context);
    const resolved = parseSetPlanningRangeCommand(text, context, pending?.pending);
    expect(resolved?.range.startDateTime).toBe(startDateTime);
  });

  it('does not treat a summer-vacation task mention as a planning range', () => {
    expect(parseSetPendingPlanningRangeCommand(
      '夏休みの宿題は数学ワーク10ページです',
      { selectedDate: '2026-06-26' },
    )).toBeUndefined();
  });

  it('prefers next week when summer vacation is explicitly negated', () => {
    const pending = parseSetPendingPlanningRangeCommand(
      '夏休みではなく来週の計画を立てたい',
      { selectedDate: '2026-06-26' },
    );
    expect(pending?.pending.scope).toMatchObject({
      kind: 'next_week',
      startDate: '2026-06-29',
      endDate: '2026-07-05',
    });
  });

  it('accepts a bare summer-vacation answer only when the caller expects a range answer', () => {
    const context = { selectedDate: '2026-06-26' };
    expect(parseSetPendingPlanningRangeCommand('夏休み', context)).toBeUndefined();
    expect(parseSetPendingPlanningRangeCommand(
      '夏休み',
      context,
      { allowBareNamedFuturePeriodAnswer: true },
    )?.pending).toEqual({
      scope: { kind: 'named_future_period', label: '夏休み' },
      sourceText: '夏休み',
    });
  });

  it('does not replace a pending next-week scope with a bare summer-vacation answer', () => {
    const context = {
      selectedDate: '2026-06-26',
      currentDateTime: '2026-06-26T12:00:00',
    };
    const nextWeek = applyWeeklyPlanningUserTurn(undefined, '来週の予定を立てたい', context);
    const answered = applyWeeklyPlanningUserTurn(nextWeek, '夏休み', context);

    expect(answered.pendingPlanningRange).toEqual(nextWeek.pendingPlanningRange);
    expect(answered.pendingPlanningRange?.scope.kind).toBe('next_week');
  });

  it('uses the affirmative side of a summer-vacation contrast as next week', () => {
    const state = applyWeeklyPlanningUserTurn(
      undefined,
      '夏休みじゃなくて来週にしたい',
      {
        selectedDate: '2026-06-26',
        currentDateTime: '2026-06-26T12:00:00',
      },
    );

    expect(state.pendingPlanningRange?.scope).toMatchObject({
      kind: 'next_week',
      startDate: '2026-06-29',
      endDate: '2026-07-05',
    });
  });

  it('combines a date-only answer with a later duration answer', () => {
    const context = {
      selectedDate: '2026-06-26',
      currentDateTime: '2026-06-26T12:00:00',
    };
    const summerVacation = applyWeeklyPlanningUserTurn(
      undefined,
      '夏休みに計画を立てたい',
      context,
    );
    const withStartDate = applyWeeklyPlanningUserTurn(summerVacation, '8月1日から', context);

    expect(withStartDate.range).toBeUndefined();
    expect(withStartDate.pendingPlanningRange).toMatchObject({
      scope: {
        kind: 'named_future_period',
        label: '夏休み',
        startDate: '2026-08-01',
      },
    });

    const resolved = applyWeeklyPlanningUserTurn(withStartDate, '一週間', context);
    expect(resolved.pendingPlanningRange).toBeUndefined();
    expect(resolved.range).toMatchObject({
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      calendarDayCount: 7,
      confidence: 'explicit',
    });
  });

  it('combines a duration-only answer with a later date answer', () => {
    const context = {
      selectedDate: '2026-06-26',
      currentDateTime: '2026-06-26T12:00:00',
    };
    const summerVacation = applyWeeklyPlanningUserTurn(
      undefined,
      '夏休みに計画を立てたい',
      context,
    );
    const withDuration = applyWeeklyPlanningUserTurn(summerVacation, '一週間', context);

    expect(withDuration.range).toBeUndefined();
    expect(withDuration.pendingPlanningRange).toMatchObject({
      scope: { kind: 'named_future_period', label: '夏休み' },
      durationDays: 7,
    });

    const resolved = applyWeeklyPlanningUserTurn(withDuration, '8月1日から', context);
    expect(resolved.pendingPlanningRange).toBeUndefined();
    expect(resolved.range).toMatchObject({
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      calendarDayCount: 7,
      confidence: 'explicit',
    });
  });

});
