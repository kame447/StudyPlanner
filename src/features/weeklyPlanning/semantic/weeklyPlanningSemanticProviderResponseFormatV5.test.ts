import { describe, expect, it } from 'vitest';
import {
  CANONICAL_RELATIVE_DAY_EXPRESSIONS,
  CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
  CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
} from './weeklyPlanningCalendarResolver';
import {
  WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5,
} from './weeklyPlanningSemanticProviderResponseFormatV5';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected schema object');
  }
  return value as Record<string, unknown>;
}

function rootProperties(): Record<string, unknown> {
  return record(
    record(WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5.json_schema.schema)
      .properties,
  );
}

function planningWindowBranch(kind: string): Record<string, unknown> {
  const planningWindow = record(rootProperties().planningWindow);
  const anyOf = planningWindow.anyOf;
  if (!Array.isArray(anyOf)) throw new Error('planningWindow.anyOf missing');

  const branch = anyOf
    .filter((value) => typeof value === 'object' && value !== null)
    .map(record)
    .find((value) => {
      const properties = value.properties;
      if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
        return false;
      }
      return record(record(properties).kind).const === kind;
    });

  if (!branch) throw new Error(`planningWindow branch missing: ${kind}`);
  return branch;
}

describe('Stable V5 provider representation schema', () => {
  it('requires ISO-shaped start/end fields for absolute planning windows', () => {
    const absolute = planningWindowBranch('absolute');
    const properties = record(absolute.properties);

    expect(record(properties.start)).toMatchObject({
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    });
    expect(record(properties.end)).toMatchObject({
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    });
  });

  it('restricts relative planning windows to canonical finite values', () => {
    const relativeDay = planningWindowBranch('relative_day');
    const relativeDayProperties = record(relativeDay.properties);
    const relativeWeek = planningWindowBranch('relative_week');
    const relativeWeekProperties = record(relativeWeek.properties);
    const namedPeriod = planningWindowBranch('named_period');
    const namedPeriodProperties = record(namedPeriod.properties);

    expect(record(relativeDayProperties.value).enum).toEqual(
      CANONICAL_RELATIVE_DAY_EXPRESSIONS,
    );
    expect(record(relativeWeekProperties.value).enum).toEqual(
      CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
    );
    expect(record(relativeWeekProperties.value).enum).not.toContain('next week');
    expect(record(relativeWeekProperties.value).enum).not.toContain('来週');
    expect(record(namedPeriodProperties.value)).toEqual({ type: 'string' });
  });

  it('restricts availability and recurrence days to canonical weekday tokens', () => {
    const properties = rootProperties();

    const availability = record(properties.availabilityDeclarations);
    const availabilityItems = record(availability.items);
    const availabilityProperties = record(availabilityItems.properties);
    const availabilityDays = record(availabilityProperties.days);
    const availabilityDayItems = record(availabilityDays.items);

    const tasks = record(properties.tasks);
    const taskItems = record(tasks.items);
    const taskProperties = record(taskItems.properties);
    const recurrence = record(taskProperties.recurrence);
    const recurrenceItems = record(recurrence.items);
    const recurrenceProperties = record(recurrenceItems.properties);
    const recurrenceDays = record(recurrenceProperties.days);
    const recurrenceDayItems = record(recurrenceDays.items);

    expect(availabilityDayItems.enum).toEqual(CANONICAL_WEEKDAY_DATE_EXPRESSIONS);
    expect(recurrenceDayItems.enum).toEqual(CANONICAL_WEEKDAY_DATE_EXPRESSIONS);
    expect(availabilityDayItems.enum).not.toContain('tuesday');
    expect(recurrenceDayItems.enum).not.toContain('tuesday');
  });
});
