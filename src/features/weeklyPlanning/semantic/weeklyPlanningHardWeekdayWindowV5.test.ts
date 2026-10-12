import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV2, type WeeklyPlanningFactGraphV2 } from './weeklyPlanningFactGraphV2';
import { resolveWeeklyPlanningDateExpressionsV5 } from './weeklyPlanningResolvedDateExpressionsV5';
import { resolveWeeklyPlanningTemporalConstraintsV5 } from './weeklyPlanningResolvedTemporalConstraintsV5';
import { resolveWeeklyPlanningTaskDateRules } from './weeklyPlanningTaskDateRuleResolver';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

const source = { conversationId: 'c', turnId: 't', semanticLocalId: 'f', sourceText: 'typed fact', origin: 'user' as const };
function graph(): WeeklyPlanningFactGraphV2 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV2(), revision: 1,
    tasks: [{ id: 'book', category: 'study', title: 'book', source, createdRevision: 1 }],
    workloads: [{ id: 'work', taskId: 'book', componentId: null, quantityRole: 'target', amount: 60,
      unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false,
      periodExpression: null, source, createdRevision: 1 }],
    temporalConstraints: (['deadline', 'latest_end', 'earliest_start'] as const).map(kind => ({
      id: kind, taskId: 'book', targetFactId: 'book', kind, constraintLevel: 'hard',
      dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: null, endTime: null,
      precision: 'exact', source, createdRevision: 1,
    })),
    taskDateRules: (['allowed_date', 'excluded_date'] as const).flatMap(kind =>
      (kind === 'allowed_date' ? ['saturday', 'sunday'] : ['wednesday', 'thursday']).map(day => ({
        id: `${kind}-${day}`, taskId: 'book', targetFactId: 'book', kind, constraintLevel: 'hard' as const,
        dateExpression: `weekday:${day}`, source, createdRevision: 1,
      }))),
  };
}
const nextWeek = { startDate: '2026-10-12', endDate: '2026-10-18' };
function resolve(currentDate: string, planningWindow?: typeof nextWeek, weekStartsOn: 'monday' | 'sunday' = 'monday') {
  const value = graph();
  const dates = resolveWeeklyPlanningDateExpressionsV5({ graph: value, currentDate, planningWindow, weekStartsOn });
  return { value, dates, bounds: resolveWeeklyPlanningTemporalConstraintsV5({ graph: value, currentDate, resolvedDateExpressions: dates }) };
}

describe('hard weekday dates within the accepted planning window', () => {
  it.each([
    ['Thursday next week', '2026-10-08', nextWeek, '2026-10-16'],
    ['Thursday this week', '2026-10-08', { startDate: '2026-10-05', endDate: '2026-10-11' }, '2026-10-09'],
    ['no explicit window', '2026-10-08', undefined, '2026-10-09'],
    ['Sunday next week', '2026-10-11', nextWeek, '2026-10-16'],
    ['multiweek future window', '2026-10-08', { startDate: '2026-10-12', endDate: '2026-10-25' }, '2026-10-16'],
    ['multiweek retains in-window request-clock occurrence', '2026-10-22', { startDate: '2026-10-12', endDate: '2026-10-25' }, '2026-10-23'],
  ] as const)('%s applies all three bounds to %s', (_name, currentDate, window, expected) => {
    const { dates, bounds } = resolve(currentDate, window);
    expect(dates.facts.filter(fact => ['deadline', 'earliest_start', 'latest_end'].includes(fact.factId))
      .map(fact => fact.range)).toEqual(Array(3).fill({ start: expected, end: expected }));
    expect(bounds.hardDateBounds).toEqual([expect.objectContaining({ startDate: expected, endDate: expected })]);
  });

  it('expands allowed/excluded weekdays into every discrete occurrence, without intervening days', () => {
    const window = { startDate: '2026-10-12', endDate: '2026-10-25' };
    const { value, dates } = resolve('2026-10-08', window);
    const eligibility = resolveWeeklyPlanningTaskDateRules({ graph: value, currentDate: '2026-10-08',
      planningStartDate: window.startDate, planningEndDate: window.endDate, resolvedDateExpressions: dates });
    expect(eligibility.issues).toEqual([]);
    expect(eligibility.eligibilities[0]).toMatchObject({
      allowedDates: ['2026-10-17', '2026-10-18', '2026-10-24', '2026-10-25'],
      excludedDates: ['2026-10-14', '2026-10-15', '2026-10-21', '2026-10-22'],
    });
  });

  it('handles Sunday-start personalization inside a Sunday-to-Saturday next week', () => {
    const { dates } = resolve('2026-10-11', { startDate: '2026-10-18', endDate: '2026-10-24' }, 'sunday');
    expect(dates.facts.find(fact => fact.factId === 'deadline')?.range).toEqual({ start: '2026-10-23', end: '2026-10-23' });
    expect(dates.facts.find(fact => fact.factId === 'allowed_date-sunday')?.dates).toEqual(['2026-10-18']);
  });

  it('does not change other fact domains, soft bounds, absolute dates or relative days', () => {
    const value = graph();
    value.temporalConstraints[0].constraintLevel = 'soft';
    value.temporalConstraints[1].dateExpression = '2026-10-09';
    value.temporalConstraints[2].dateExpression = 'tomorrow';
    const dates = resolveWeeklyPlanningDateExpressionsV5({ graph: {
      ...value, availabilityDeclarations: [{ id: 'plan-preference', dateExpression: 'weekday:friday' }],
    }, currentDate: '2026-10-08', planningWindow: nextWeek });
    for (const id of ['deadline', 'latest_end', 'earliest_start', 'plan-preference']) {
      expect(dates.facts.find(fact => fact.factId === id)?.range).toEqual({ start: '2026-10-09', end: '2026-10-09' });
    }
  });

  it('asks for an unsatisfied weekday in a short window instead of dropping a hard rule', () => {
    const value = graph();
    const dates = resolveWeeklyPlanningDateExpressionsV5({ graph: value, currentDate: '2026-10-08',
      planningWindow: { startDate: '2026-10-12', endDate: '2026-10-13' } });
    const eligibility = resolveWeeklyPlanningTaskDateRules({ graph: value, currentDate: '2026-10-08',
      planningStartDate: '2026-10-12', planningEndDate: '2026-10-13', resolvedDateExpressions: dates });
    expect(eligibility.readiness).toBe('needs_resolution');
    expect(eligibility.issues.every(issue => issue.blocking)).toBe(true);
  });

  it('uses the same snapshot in direct scheduler compilation when an explicit window exists', () => {
    const value = graph();
    value.temporalConstraints = value.temporalConstraints.filter(fact => fact.kind === 'deadline');
    value.taskDateRules = value.taskDateRules.filter(fact => fact.kind === 'excluded_date');
    value.planningWindows = [{ id: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, source, createdRevision: 1 }];
    const compiled = compileGenericSchedulerInput({ graph: value, context: { ownerId: 'owner', currentDate: '2026-10-08',
      planningStartDate: nextWeek.startDate, planningEndDate: nextWeek.endDate, timeZone: 'Asia/Tokyo' } });
    expect(compiled.issues).toEqual([]);
    expect(compiled.input?.hardDateBounds[0].endDate).toBe('2026-10-16');
    expect(compiled.input?.taskDateEligibilities[0].excludedDates).toEqual(['2026-10-14', '2026-10-15']);
  });
  it.each(['2026-10-08', '2026-10-11'])('blocks resolved out-of-window hard bounds on %s without a capacity claim', currentDate => {
    for (const [kind, dateExpression] of [['deadline', '2026-10-09'], ['latest_end', '2026-10-09'], ['earliest_start', '2026-10-19']] as const) {
      const value = graph();
      value.taskDateRules = [];
      value.temporalConstraints = value.temporalConstraints.filter(fact => fact.kind === kind);
      value.temporalConstraints[0].dateExpression = dateExpression;
      value.planningWindows = [{ id: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, source, createdRevision: 1 }];
      const compiled = compileGenericSchedulerInput({ graph: value, context: { ownerId: 'owner', currentDate,
        planningStartDate: nextWeek.startDate, planningEndDate: nextWeek.endDate, timeZone: 'Asia/Tokyo' } });
      expect(compiled.status).toBe('needs_resolution');
      expect(compiled.input).toBeNull();
      expect(compiled.issues).toEqual([expect.objectContaining({ code: 'hard_date_bound_outside_planning_window', blocking: true, factId: kind })]);
    }
  });

  it('does not judge bounds against an unresolved horizon (parent integration guard)', () => {
    const value = graph();
    value.taskDateRules = [];
    value.temporalConstraints = value.temporalConstraints.filter(fact => fact.kind === 'earliest_start');
    value.temporalConstraints[0].dateExpression = '2026-10-13';
    const compiled = compileGenericSchedulerInput({ graph: value, context: { ownerId: 'owner', currentDate: '2026-10-08',
      planningStartDate: '', planningEndDate: '', timeZone: 'Asia/Tokyo' } });
    expect(compiled.issues.some(issue => issue.code === 'hard_date_bound_outside_planning_window')).toBe(false);
  });

});
