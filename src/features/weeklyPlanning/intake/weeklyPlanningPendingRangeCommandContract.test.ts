import { describe, expect, it } from 'vitest';
import { normalizeSetPendingPlanningRangeCommand } from './weeklyPlanningCommandAdapter';
import {
  canonicalizeOptionalCommandNulls,
  isValidWeeklyPlanningCommand,
} from './weeklyPlanningCommandRuntimeValidation';
import type { SetPendingPlanningRangeCommand } from './weeklyPlanningCommandTypes';

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

  it('normalizes an omitted duration for named future periods as well', () => {
    const normalized = normalizeSetPendingPlanningRangeCommand(
      commandWithoutDuration('named_future_period'),
      { selectedDate: '2026-07-16' },
    );
    expect(normalized.pending.durationDays).toBe(7);
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
});
