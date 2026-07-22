import { describe, expect, it } from 'vitest';
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

function graph(rules: TaskDateRuleFact[]): WeeklyPlanningFactGraphV2 {
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
    taskDateRules: rules,
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
      graph: graph([rule('allow-1', 'allowed_date', '2026-07-24')]),
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

  it('excludes one date while allowing the remaining planning dates', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph([rule('exclude-1', 'excluded_date', '2026-07-25')]),
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
      graph: graph([
        rule('allow-1', 'allowed_date', '2026-07-24'),
        rule('exclude-1', 'excluded_date', '2026-07-24'),
      ]),
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
      graph: graph([rule('allow-custom', 'allowed_date', 'custom:試験前日')]),
      ...context,
    });

    expect(result.readiness).toBe('needs_resolution');
    expect(result.issues[0]).toMatchObject({
      code: 'unsupported_task_date_expression',
      taskDateRuleFactId: 'allow-custom',
      blocking: true,
    });
  });

  it('does not turn an out-of-range rule into a different date', () => {
    const result = resolveWeeklyPlanningTaskDateRules({
      graph: graph([rule('allow-next', 'allowed_date', '2026-08-01')]),
      ...context,
    });

    expect(result.eligibilities[0].allowedDates).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'task_date_rule_outside_planning_window',
      blocking: false,
    }));
  });
});
