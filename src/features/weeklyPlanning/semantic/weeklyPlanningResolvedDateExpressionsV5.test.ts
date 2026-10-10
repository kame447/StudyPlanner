import { describe, expect, it } from 'vitest';
import {
  resolveWeeklyPlanningDateExpressionsV5,
} from './weeklyPlanningResolvedDateExpressionsV5';

describe('weekly planning resolved date expressions', () => {
  it('grounds tomorrow from the captured request date', () => {
    const resolved = resolveWeeklyPlanningDateExpressionsV5({
      graph: {
        temporalConstraints: [{ id: 'deadline-1', dateExpression: 'tomorrow' }],
      },
      currentDate: '2026-08-26',
      weekStartsOn: 'monday',
    });

    expect(resolved).toMatchObject({
      referenceDate: '2026-08-26',
      weekStartsOn: 'monday',
      facts: [{
        factId: 'deadline-1',
        expression: 'tomorrow',
        status: 'resolved',
        range: { start: '2026-08-27', end: '2026-08-27' },
      }],
    });
  });

  it('grounds next_week once with Sunday-start personalization', () => {
    const resolved = resolveWeeklyPlanningDateExpressionsV5({
      graph: {
        taskDateRules: [{ id: 'rule-1', dateExpression: 'next_week' }],
      },
      currentDate: '2026-08-26',
      weekStartsOn: 'sunday',
    });

    expect(resolved.facts[0]).toMatchObject({
      status: 'resolved',
      range: { start: '2026-08-30', end: '2026-09-05' },
    });
  });

  it('gives the same absolute range to the same expression across scheduler fact domains', () => {
    const resolved = resolveWeeklyPlanningDateExpressionsV5({
      graph: {
        temporalConstraints: [{ id: 'constraint-1', dateExpression: 'next_week' }],
        taskDateRules: [{ id: 'rule-1', dateExpression: 'next_week' }],
        availabilityDeclarations: [{ id: 'availability-1', dateExpression: 'next_week' }],
      },
      currentDate: '2026-08-26',
      weekStartsOn: 'sunday',
    });

    expect(resolved.facts).toHaveLength(3);
    expect(resolved.facts.map((fact) => fact.range)).toEqual([
      { start: '2026-08-30', end: '2026-09-05' },
      { start: '2026-08-30', end: '2026-09-05' },
      { start: '2026-08-30', end: '2026-09-05' },
    ]);
  });

  it('keeps unresolved custom expressions unresolved instead of inventing a date', () => {
    const resolved = resolveWeeklyPlanningDateExpressionsV5({
      graph: {
        availabilityDeclarations: [{
          id: 'availability-custom',
          dateExpression: 'custom:試験前日',
        }],
      },
      currentDate: '2026-08-26',
      weekStartsOn: 'monday',
    });

    expect(resolved.facts[0]).toMatchObject({
      factId: 'availability-custom',
      status: 'unsupported_expression',
      range: null,
    });
  });

  it.each([false, true])('shares canonical preferred weekdays only with an accepted range (accepted=%s)', (accepted) => {
    const resolved = resolveWeeklyPlanningDateExpressionsV5({
      graph: {
        temporalConstraints: [{ id: 'task-preferred', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: 'weekday:friday' }],
        availabilityDeclarations: [{ id: 'plan-preferred', kind: 'preferred', constraintLevel: 'soft', recurrenceKind: null, dateExpression: 'weekday:friday' }],
      },
      currentDate: '2026-10-08',
      planningWindow: accepted ? { startDate: '2026-10-12', endDate: '2026-10-23' } : null,
    });
    expect(resolved.referenceDate).toBe('2026-10-08');
    for (const fact of resolved.facts) {
      expect(fact.range).toEqual(accepted
        ? { start: '2026-10-16', end: '2026-10-23' }
        : { start: '2026-10-09', end: '2026-10-09' });
      expect(fact.dates).toEqual(accepted ? ['2026-10-16', '2026-10-23'] : undefined);
    }
  });

  it.each([
    { expression: '2026-10-09', recurrenceKind: null, kind: 'preferred', constraintLevel: 'soft', start: '2026-10-09', end: '2026-10-09' },
    { expression: 'tomorrow', recurrenceKind: null, kind: 'preferred', constraintLevel: 'soft', start: '2026-10-09', end: '2026-10-09' },
    { expression: 'next_week', recurrenceKind: null, kind: 'preferred', constraintLevel: 'soft', start: '2026-10-12', end: '2026-10-18' },
    { expression: 'weekday:friday', recurrenceKind: 'weekly', kind: 'preferred', constraintLevel: 'soft', start: '2026-10-09', end: '2026-10-09' },
    { expression: 'weekday:friday', recurrenceKind: null, kind: 'available', constraintLevel: 'hard', start: '2026-10-09', end: '2026-10-09' },
  ])('preserves request grounding for $expression / $recurrenceKind / $constraintLevel availability', (sample) => {
    const resolved = resolveWeeklyPlanningDateExpressionsV5({
      graph: { availabilityDeclarations: [{ id: 'availability', dateExpression: sample.expression, ...sample }] },
      currentDate: '2026-10-08', planningWindow: { startDate: '2026-10-12', endDate: '2026-10-23' },
    });
    expect(resolved.facts[0].range).toEqual({ start: sample.start, end: sample.end });
    expect(resolved.facts[0].dates).toBeUndefined();
  });

});
