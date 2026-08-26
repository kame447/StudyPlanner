import { describe, expect, it } from 'vitest';
import type { RecurrenceFact } from './weeklyPlanningFactGraph';
import {
  createEmptyWeeklyPlanningFactGraphV2,
  type TaskDateRuleFact,
  type WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import {
  isTaskAllowedOnDate,
  resolveWeeklyPlanningTaskDateRules,
} from './weeklyPlanningTaskDateRuleResolver';

function source(id: string) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: id,
    origin: 'user' as const,
  };
}

function rule(
  id: string,
  kind: TaskDateRuleFact['kind'],
  dateExpression: string,
): TaskDateRuleFact {
  return {
    id,
    taskId: 'task-1',
    targetFactId: 'task-1',
    kind,
    dateExpression,
    constraintLevel: 'hard',
    source: source(id),
    createdRevision: 1,
  };
}

function recurrence(
  id: string,
  kind: RecurrenceFact['kind'],
  days: string[],
): RecurrenceFact {
  return {
    id,
    taskId: 'task-1',
    targetFactId: 'task-1',
    kind,
    count: null,
    days,
    source: source(id),
    createdRevision: 1,
  };
}

function graph(params: {
  rules?: TaskDateRuleFact[];
  recurrences?: RecurrenceFact[];
} = {}): WeeklyPlanningFactGraphV2 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV2(),
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '英単語',
      source: source('task-1'),
      createdRevision: 1,
    }],
    taskDateRules: params.rules ?? [],
    recurrences: params.recurrences ?? [],
  };
}

const context = {
  currentDate: '2026-07-22',
  planningStartDate: '2026-07-20',
  planningEndDate: '2026-07-26',
};

describe('weekly planning task date rule resolver', () => {
  it('keeps a task only on explicitly allowed dates', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph({ rules: [rule('allow-1', 'allowed_date', '2026-07-24')] }),
      ...context,
    });

    expect(result.readiness).toBe('ready');
    expect(result.eligibilities).toEqual([{
      taskId: 'task-1',
      allowedDates: ['2026-07-24'],
      excludedDates: [],
      sourceFactIds: ['allow-1'],
    }]);
    expect(isTaskAllowedOnDate(result.eligibilities[0], '2026-07-24')).toBe(true);
    expect(isTaskAllowedOnDate(result.eligibilities[0], '2026-07-25')).toBe(false);
  });

  it('unions multiple non-consecutive allowed dates', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph({
        rules: [
          rule('allow-1', 'allowed_date', '2026-07-20'),
          rule('allow-2', 'allowed_date', '2026-07-22'),
          rule('allow-3', 'allowed_date', '2026-07-23'),
        ],
      }),
      ...context,
    });

    expect(result.eligibilities[0]).toEqual({
      taskId: 'task-1',
      allowedDates: ['2026-07-20', '2026-07-22', '2026-07-23'],
      excludedDates: [],
      sourceFactIds: ['allow-1', 'allow-2', 'allow-3'],
    });
  });

  it('resolves a discontinuous weekday set into concrete allowed dates', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph({
        recurrences: [recurrence('recurrence-1', 'weekly', ['wed', 'fri', 'sat', 'sun'])],
      }),
      ...context,
    });

    expect(result.readiness).toBe('ready');
    expect(result.eligibilities[0]).toEqual({
      taskId: 'task-1',
      allowedDates: ['2026-07-22', '2026-07-24', '2026-07-25', '2026-07-26'],
      excludedDates: [],
      sourceFactIds: ['recurrence-1'],
    });
  });

  it('resolves a custom recurrence with canonical weekdays by the shared calendar rule', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph({
        recurrences: [recurrence('recurrence-custom', 'custom', ['wed', 'fri', 'sun'])],
      }),
      ...context,
    });

    expect(result.readiness).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.eligibilities[0]).toEqual({
      taskId: 'task-1',
      allowedDates: ['2026-07-22', '2026-07-24', '2026-07-26'],
      excludedDates: [],
      sourceFactIds: ['recurrence-custom'],
    });
  });

  it('subtracts an exact excluded date from a weekday recurrence', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph({
        rules: [rule('exclude-1', 'excluded_date', '2026-07-25')],
        recurrences: [recurrence('recurrence-1', 'weekly', ['wed', 'fri', 'sat', 'sun'])],
      }),
      ...context,
    });

    expect(result.eligibilities[0]).toEqual({
      taskId: 'task-1',
      allowedDates: ['2026-07-22', '2026-07-24', '2026-07-26'],
      excludedDates: ['2026-07-25'],
      sourceFactIds: ['exclude-1', 'recurrence-1'],
    });
  });

  it('excludes one date while allowing the remaining planning dates', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph({ rules: [rule('exclude-1', 'excluded_date', '2026-07-25')] }),
      ...context,
    });

    expect(result.eligibilities[0]).toEqual({
      taskId: 'task-1',
      allowedDates: null,
      excludedDates: ['2026-07-25'],
      sourceFactIds: ['exclude-1'],
    });
    expect(isTaskAllowedOnDate(result.eligibilities[0], '2026-07-24')).toBe(true);
    expect(isTaskAllowedOnDate(result.eligibilities[0], '2026-07-25')).toBe(false);
  });

  it('blocks contradictory allow and exclude rules for the same date', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph({
        rules: [
          rule('allow-1', 'allowed_date', '2026-07-24'),
          rule('exclude-1', 'excluded_date', '2026-07-24'),
        ],
      }),
      ...context,
    });

    expect(result.readiness).toBe('needs_resolution');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'conflicting_task_date_rule',
      taskId: 'task-1',
      blocking: true,
      details: { date: '2026-07-24' },
    }));
  });

  it('keeps custom dates unresolved instead of parsing Japanese later', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph({ rules: [rule('allow-custom', 'allowed_date', 'custom:試験前日')] }),
      ...context,
    });

    expect(result.readiness).toBe('needs_resolution');
    expect(result.issues[0]).toMatchObject({
      code: 'unsupported_task_date_expression',
      taskDateRuleFactId: 'allow-custom',
      blocking: true,
    });
  });

  it('blocks a non-canonical weekday code', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph({
        recurrences: [recurrence('recurrence-invalid', 'weekly', ['水曜'])],
      }),
      ...context,
    });

    expect(result.readiness).toBe('needs_resolution');
    expect(result.issues[0]).toMatchObject({
      code: 'invalid_task_recurrence_weekday',
      taskDateRuleFactId: 'recurrence-invalid',
      blocking: true,
      details: { day: '水曜' },
    });
  });

  it('does not turn an out-of-range rule into a different date', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph({ rules: [rule('allow-next', 'allowed_date', '2026-08-01')] }),
      ...context,
    });

    expect(result.eligibilities[0].allowedDates).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'task_date_rule_outside_planning_window',
      blocking: false,
    }));
  });
});
