import { describe, expect, it } from 'vitest';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { compileWeeklyPlanningVNextSchedulerInput, createWeeklyPlanningVNextSchedulerContext } from '../projection/weeklyPlanningVNextSchedulerGraph';
import { scheduleWeeklyPlanningStableV5Preview } from '../weeklyPlanningVNextV5Boundary';
import type { VNextAddFact, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';

// c-6: "N times this week" is recorded as a recurrence (`times_per_week`, count N). Once each session's amount is known, the
// plan has N sessions, not one: the count says how many, placement chooses the days. Week of 2026-11-02 (7 days).
const CURRENT = '2026-11-02';
const empty = { patch: [], remove: [], relate: [], defer: [] };

function state(options: { kind: string; count: number | null; perOccurrence?: boolean }): WeeklyPlanningVNextState {
  const add: VNextAddFact[] = [
    { kind: 'task', localId: 'kobun', category: 'study', title: '古文単語の暗記' },
    { kind: 'workload', localId: 'w', taskRef: { localId: 'kobun' }, componentRef: null, quantityRole: 'target', amount: 30, unitCode: 'minute',
      unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: options.perOccurrence ?? true, periodExpression: null },
    { kind: 'recurrence', localId: 'r', taskRef: { localId: 'kobun' }, targetRef: { localId: 'kobun' }, recurrenceKind: options.kind as never,
      count: options.count, days: [] },
  ];
  const result = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), { ...empty, add }, {
    expectedRevision: 0, acceptedDate: CURRENT, weekStartsOn: 'monday', planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
    defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, conversationId: 'times', turnId: 't', turnKey: 't', sourceText: 'synthetic' });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}

function plan(s: WeeklyPlanningVNextState) {
  const projection = projectWeeklyPlanningVNext(s);
  const context = createWeeklyPlanningVNextSchedulerContext({ state: s, ownerId: 'owner', selectedDate: CURRENT,
    requestContext: { currentDate: CURRENT, currentTime: '09:00', notBeforeDate: CURRENT, notBeforeTime: '09:00', timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday', startedAtIso: `${CURRENT}T00:00:00.000Z` } });
  const compiled = compileWeeklyPlanningVNextSchedulerInput({ state: s, projection, context });
  if (compiled.status !== 'compiled' || !compiled.compilation.input) throw new Error(`not compiled: ${compiled.status}`);
  const scheduled = scheduleWeeklyPlanningStableV5Preview({ input: compiled.compilation.input, graph: compiled.placementGraph, plans: [], monthEvents: [],
    scheduleTemplates: [], notBefore: { date: CURRENT, time: '09:00' } });
  if (scheduled.status !== 'ready') throw new Error(`not scheduled: ${scheduled.status}`);
  return { items: compiled.compilation.input.movableWorkItems, candidates: scheduled.candidates };
}

describe('"N times a week" with a known amount per session reaches the plan', () => {
  it.each([2, 3, 4, 5])('plans %i sessions of the stated amount, each on a different day', count => {
    const { items, candidates } = plan(state({ kind: 'times_per_week', count }));
    expect(items).toHaveLength(count);
    expect(new Set(items.map(item => item.id)).size).toBe(count);
    expect(candidates).toHaveLength(count);
    expect(candidates.every(candidate => candidate.durationMinutes === 30)).toBe(true);
    expect(new Set(candidates.map(candidate => candidate.date)).size).toBe(count);
  });

  it('keeps the single item when the count says one or is not a whole number (a missing count is rejected earlier, at input)', () => {
    for (const count of [1, 2.5]) {
      const { items } = plan(state({ kind: 'times_per_week', count }));
      expect(items).toHaveLength(1);
      expect(items[0].id).not.toContain(':recurrence:');
    }
    expect(() => state({ kind: 'times_per_week', count: null })).toThrow();
  });

  it('never makes more sessions than there are days in the period', () => {
    const { items, candidates } = plan(state({ kind: 'times_per_week', count: 9 }));
    expect(items).toHaveLength(7);
    expect(candidates.length).toBeLessThanOrEqual(7);
  });

  it('leaves a quantity that is not per occurrence alone, and the other recurrences as they were', () => {
    expect(plan(state({ kind: 'times_per_week', count: 4, perOccurrence: false })).items).toHaveLength(1);
    expect(plan(state({ kind: 'daily', count: null })).items).toHaveLength(7);
    expect(plan(state({ kind: 'weekdays', count: null })).items).toHaveLength(5);
  });
});
