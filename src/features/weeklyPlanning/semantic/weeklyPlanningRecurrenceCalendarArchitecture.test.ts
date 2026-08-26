import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('weekly planning recurrence calendar ownership', () => {
  it('keeps concrete recurrence-date expansion in the shared calendar module', () => {
    const consumers = [
      source('./weeklyPlanningSchedulerWorkDistributionV5.ts'),
      source('./weeklyPlanningTaskDateRuleResolver.ts'),
      source('./weeklyPlanningTaskCommitmentResolver.ts'),
      source('./weeklyPlanningAvailabilityResolver.ts'),
    ];

    for (const consumer of consumers) {
      expect(consumer).toContain('resolveWeeklyPlanningCalendarRecurrenceDatesV5');
      expect(consumer).not.toContain('const WEEKDAY_INDEX');
      expect(consumer).not.toContain('calendarWeekday(');
    }
  });

  it('keeps fallback-horizon recurrence expandability on the same shared rule', () => {
    const temporalContext = source('../application/weeklyPlanningTemporalContext.ts');

    expect(temporalContext).toContain('isWeeklyPlanningCalendarExpandableRecurrenceV5');
    expect(temporalContext).not.toContain('isExpandedRecurrenceKind');
    expect(temporalContext).not.toContain("kind === 'weekdays'");
    expect(temporalContext).not.toContain("kind === 'weekends'");
  });
});
