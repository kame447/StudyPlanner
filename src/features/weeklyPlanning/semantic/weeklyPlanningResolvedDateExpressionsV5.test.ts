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
});
