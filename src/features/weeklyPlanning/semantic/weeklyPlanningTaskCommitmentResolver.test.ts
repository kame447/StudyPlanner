import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV2,
  type WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import {
  resolveWeeklyPlanningDateExpressionsV5,
} from './weeklyPlanningResolvedDateExpressionsV5';
import { resolveWeeklyPlanningTaskCommitments } from './weeklyPlanningTaskCommitmentResolver';

function source(semanticLocalId: string, sourceText: string) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId,
    sourceText,
    origin: 'user' as const,
  };
}

function graph(): WeeklyPlanningFactGraphV2 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV2(),
    revision: 1,
    tasks: [
      {
        id: 'task-dinner',
        category: 'non_study',
        title: '夕食',
        source: source('task-dinner', '夕食'),
        createdRevision: 1,
      },
    ],
    temporalConstraints: [
      {
        id: 'constraint-dinner',
        taskId: 'task-dinner',
        targetFactId: 'task-dinner',
        kind: 'fixed_interval',
        constraintLevel: 'hard',
        dateExpression: 'today',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '19:00',
        precision: 'exact',
        source: source('constraint-dinner', '今日18時から19時まで夕食'),
        createdRevision: 1,
      },
    ],
  };
}

const context = {
  currentDate: '2026-07-22',
  planningStartDate: '2026-07-20',
  planningEndDate: '2026-07-26',
  timeZone: 'Asia/Tokyo',
} as const;

function resolve(
  value: WeeklyPlanningFactGraphV2,
  contextOverride: typeof context | {
    currentDate: string;
    planningStartDate: string;
    planningEndDate: string;
    timeZone: string;
  } = context,
) {
  const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5({
    graph: value,
    currentDate: contextOverride.currentDate,
  });
  return resolveWeeklyPlanningTaskCommitments({
    graph: value,
    context: contextOverride,
    resolvedDateExpressions,
  });
}

describe('weekly planning task commitment resolver', () => {
  it('resolves a hard fixed task into a task-bound reservation', () => {
    const result = resolve(graph());

    expect(result).toMatchObject({ readiness: 'ready', issues: [] });
    expect(result.reservations).toEqual([
      expect.objectContaining({
        taskId: 'task-dinner',
        temporalConstraintFactId: 'constraint-dinner',
        start: { date: '2026-07-22', time: '18:00' },
        end: { date: '2026-07-22', time: '19:00' },
        sourceKind: 'user_commitment',
        sourceRef: 'constraint-dinner',
      }),
    ]);
  });

  it('expands recurring weekday commitments inside the planning window', () => {
    const value = graph();
    value.temporalConstraints[0].dateExpression = null;
    value.recurrences = [
      {
        id: 'recurrence-dinner',
        taskId: 'task-dinner',
        targetFactId: 'task-dinner',
        kind: 'weekdays',
        count: null,
        days: [],
        source: source('recurrence-dinner', '平日'),
        createdRevision: 1,
      },
    ];

    const result = resolve(value);

    expect(result.issues).toEqual([]);
    expect(result.reservations).toHaveLength(5);
    expect(result.reservations.map((item) => item.start.date)).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
    ]);
  });

  it('expands custom commitments from canonical weekdays by the shared calendar rule', () => {
    const value = graph();
    value.temporalConstraints[0].dateExpression = null;
    value.recurrences = [
      {
        id: 'recurrence-custom',
        taskId: 'task-dinner',
        targetFactId: 'task-dinner',
        kind: 'custom',
        count: null,
        days: ['wed', 'fri', 'sun'],
        source: source('recurrence-custom', '水金日'),
        createdRevision: 1,
      },
    ];

    const result = resolve(value);

    expect(result.readiness).toBe('ready');
    expect(result.issues).toEqual([]);
    expect(result.reservations.map((item) => item.start.date)).toEqual([
      '2026-07-22',
      '2026-07-24',
      '2026-07-26',
    ]);
  });

  it('keeps cross-midnight commitments as next-day reservations', () => {
    const value = graph();
    value.temporalConstraints[0].startTime = '23:00';
    value.temporalConstraints[0].endTime = '00:30';

    const result = resolve(value);

    expect(result.reservations[0]).toMatchObject({
      start: { date: '2026-07-22', time: '23:00' },
      end: { date: '2026-07-23', time: '00:30' },
    });
  });

  it('blocks a fixed interval without date scope in a multi-day plan', () => {
    const value = graph();
    value.temporalConstraints[0].dateExpression = null;

    const result = resolve(value);

    expect(result.reservations).toEqual([]);
    expect(result.readiness).toBe('needs_resolution');
    expect(result.issues).toContainEqual({
      code: 'missing_commitment_date_scope',
      temporalConstraintFactId: 'constraint-dinner',
      taskId: 'task-dinner',
      blocking: true,
    });
  });

  it('allows an unscoped fixed interval only when the plan is one day', () => {
    const value = graph();
    value.temporalConstraints[0].dateExpression = null;
    const oneDayContext = {
      ...context,
      planningStartDate: '2026-07-22',
      planningEndDate: '2026-07-22',
    };

    const result = resolve(value, oneDayContext);

    expect(result.readiness).toBe('ready');
    expect(result.reservations[0].start.date).toBe('2026-07-22');
  });

  it('blocks unknown or soft fixed-interval strength', () => {
    for (const level of ['unknown', 'soft'] as const) {
      const value = graph();
      value.temporalConstraints[0].constraintLevel = level;
      const result = resolve(value);

      expect(result.reservations).toEqual([]);
      expect(result.issues[0].code).toBe(
        level === 'unknown'
          ? 'unknown_commitment_constraint_level'
          : 'soft_fixed_interval_not_allowed',
      );
    }
  });

  it('rejects ambiguous task recurrences instead of choosing one', () => {
    const value = graph();
    value.temporalConstraints[0].dateExpression = null;
    value.recurrences = [
      {
        id: 'recurrence-1',
        taskId: 'task-dinner',
        targetFactId: 'task-dinner',
        kind: 'weekdays',
        count: null,
        days: [],
        source: source('recurrence-1', '平日'),
        createdRevision: 1,
      },
      {
        id: 'recurrence-2',
        taskId: 'task-dinner',
        targetFactId: 'task-dinner',
        kind: 'weekends',
        count: null,
        days: [],
        source: source('recurrence-2', '週末'),
        createdRevision: 1,
      },
    ];

    const result = resolve(value);

    expect(result.reservations).toEqual([]);
    expect(result.issues).toContainEqual({
      code: 'ambiguous_commitment_recurrence',
      temporalConstraintFactId: 'constraint-dinner',
      taskId: 'task-dinner',
      blocking: true,
      details: { recurrenceCount: 2 },
    });
  });

  it('keeps custom date expressions unresolved instead of parsing source text', () => {
    const value = graph();
    value.temporalConstraints[0].dateExpression = 'custom:試験前日';

    const result = resolve(value);

    expect(result.reservations).toEqual([]);
    expect(result.readiness).toBe('needs_resolution');
    expect(result.issues[0]).toMatchObject({
      code: 'unsupported_commitment_date_expression',
      temporalConstraintFactId: 'constraint-dinner',
      taskId: 'task-dinner',
      blocking: true,
      details: { expression: 'custom:試験前日' },
    });
  });

  it('does not turn non-fixed task constraints into occupied reservations', () => {
    const value = graph();
    value.temporalConstraints[0].kind = 'latest_end';
    value.temporalConstraints[0].startTime = null;

    const result = resolve(value);

    expect(result).toEqual({
      reservations: [],
      issues: [],
      readiness: 'empty',
    });
  });
});
