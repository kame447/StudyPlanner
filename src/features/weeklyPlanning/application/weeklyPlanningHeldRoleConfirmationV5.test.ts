import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { isHeldRoleConfirmationV5, openRoleNeedsV5 } from './weeklyPlanningHeldRoleConfirmationV5';

const ctx = (topicId: string | undefined, code = 'quantity_role_unresolved') =>
  ({ kind: 'missing', targetSlot: `stable_v5:${code}`, topicId }) as never;
function graph(role = 'declared', unit = 'minute'): WeeklyPlanningFactGraphV5 {
  const base = createEmptyWeeklyPlanningFactGraphV5();
  return {
    ...base, tasks: [{ id: 'T', title: '卒研', category: 'study' }] as never,
    workloads: [{ id: 'W', taskId: 'T', componentId: null, quantityRole: role, amount: 120, unitCode: unit, unitLabel: '分', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null, source: { sourceText: '合計2時間くらい' } }] as never,
    factLifecycles: ['T', 'W'].map(factId => ({ factId, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null })),
  };
}

describe('isHeldRoleConfirmationV5', () => {
  it('holds only the SAME role confirmation of a declared clock amount that the previous turn presented', () => {
    expect(isHeldRoleConfirmationV5({ previous: ctx('W'), next: ctx('W'), graph: graph() })).toBe(true);
    expect(isHeldRoleConfirmationV5({ previous: ctx('X'), next: ctx('W'), graph: graph() })).toBe(false);
    expect(isHeldRoleConfirmationV5({ previous: ctx('W', 'missing_schedulable_work'), next: ctx('W'), graph: graph() })).toBe(false);
    expect(isHeldRoleConfirmationV5({ previous: undefined, next: ctx('W'), graph: graph() })).toBe(false);
    expect(isHeldRoleConfirmationV5({ previous: ctx('W'), next: ctx('W', 'missing_effort_estimate'), graph: graph() })).toBe(false);
  });
  it('never holds a non-declared or non-clock amount (other role questions are unchanged)', () => {
    expect(isHeldRoleConfirmationV5({ previous: ctx('W'), next: ctx('W'), graph: graph('unknown') })).toBe(false);
    expect(isHeldRoleConfirmationV5({ previous: ctx('W'), next: ctx('W'), graph: graph('declared', 'page') })).toBe(false);
  });
  it('lists the open item as a typed need with a bounded user quote', () => {
    expect(openRoleNeedsV5({ workloads: graph().workloads })).toEqual([{ need: 'role_unresolved', workloadFactId: 'W', amount: 120, unitCode: 'minute', quote: '合計2時間くらい' }]);
    expect(openRoleNeedsV5(undefined)).toEqual([]);
  });
});
