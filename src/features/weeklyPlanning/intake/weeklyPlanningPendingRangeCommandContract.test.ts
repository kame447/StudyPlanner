import { describe, expect, it } from 'vitest';
import { normalizeSetPendingPlanningRangeCommand } from './weeklyPlanningCommandAdapter';
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

  it('does not resolve a next-week pending range with an explicit date outside its window', () => {
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

    const resolved = parseSetPlanningRangeCommand(
      '8月1日から一週間',
      context,
      pending?.pending,
    );
    expect(resolved).toBeUndefined();
  });
});
