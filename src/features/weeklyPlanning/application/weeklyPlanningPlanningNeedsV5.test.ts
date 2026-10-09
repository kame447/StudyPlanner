import { describe, expect, it } from 'vitest';
import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { blockingPlanningNeedsV5, calendarFreeV5, isAmountPlanningNeedV5 } from './weeklyPlanningPlanningNeedsV5';

const input = (extra: Record<string, unknown> = {}) => ({
  horizon: { startDate: '2026-10-12', endDate: '2026-10-14' }, availabilityWindows: [], fixedTaskReservations: [], movableWorkItems: [], ...extra,
}) as unknown as GenericSchedulerInput;
const plan = (date: string, startTime: string, endTime: string) => ({ id: `p-${date}`, userId: 'u', date, startTime, endTime, repeat: 'none', title: 't', subject: '', type: 'other' }) as never;

describe('calendarFreeV5', () => {
  it('lists every day of the period with free minutes and at most 3 of the largest windows, busy time (with its buffer) removed', () => {
    const days = calendarFreeV5({ schedulerInput: input(), plans: [plan('2026-10-13', '12:00', '14:00')], scheduleTemplates: [], ownerId: 'u' });
    expect(days.map(day => day.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(days[0]).toEqual({ date: '2026-10-12', freeMinutes: 13 * 60, windows: ['09:00-22:00'] });
    expect(days[1].windows).toEqual(['09:00-11:50', '14:10-22:00']);
    expect(days[1].freeMinutes).toBe(170 + 470);
  });
  it('keeps only the 3 largest free windows of a day, in time order', () => {
    const plans = [plan('2026-10-12', '10:00', '10:30'), plan('2026-10-12', '12:00', '12:30'), plan('2026-10-12', '14:00', '14:30'), plan('2026-10-12', '16:00', '16:30')];
    const [monday] = calendarFreeV5({ schedulerInput: input(), plans, scheduleTemplates: [], ownerId: 'u' });
    expect(monday.windows).toHaveLength(3);
    expect(monday.windows).toEqual([...monday.windows].sort());
    expect(monday.windows).toContain('16:40-22:00');
  });
  it('falls back to the resolved period when no scheduler input exists, and to nothing without any period', () => {
    expect(calendarFreeV5({ schedulerInput: null, horizon: { startDate: '2026-10-12', endDate: '2026-10-12' }, plans: [], scheduleTemplates: [] })).toHaveLength(1);
    expect(calendarFreeV5({ schedulerInput: null, horizon: null, plans: [], scheduleTemplates: [] })).toEqual([]);
  });
  it('never offers time before notBefore', () => {
    const days = calendarFreeV5({ schedulerInput: input(), plans: [], scheduleTemplates: [], notBefore: { date: '2026-10-13', time: '18:00' } });
    expect(days[0].freeMinutes).toBe(0);
    expect(days[1].windows).toEqual(['18:00-22:00']);
  });
});

describe('planning needs', () => {
  it('only amount questions ask for the calendar', () => {
    expect(isAmountPlanningNeedV5('missing_schedulable_work')).toBe(true);
    expect(isAmountPlanningNeedV5('missing_effort_estimate')).toBe(true);
    for (const code of ['semantic_uncertainty', 'quantity_role_unresolved', 'invalid_planning_horizon', null, undefined]) expect(isAmountPlanningNeedV5(code)).toBe(false);
  });
  it('states the asked question as a need once, with the richer role entry replacing the generic role need (no duplicates, bounded)', () => {
    const compilation = { status: 'empty', issues: [], input: null } as never;
    const role = { need: 'role_unresolved' as const, workloadFactId: 'W', amount: 120, unitCode: 'minute' as const, quote: 'q' };
    expect(blockingPlanningNeedsV5({ compilation, openRoleNeeds: [role], asked: { code: 'quantity_role_unresolved', factId: 'W' } })).toEqual([role]);
    expect(blockingPlanningNeedsV5({ compilation, openRoleNeeds: [], asked: { code: 'missing_schedulable_work', factId: 'T' } }))
      .toEqual([{ need: 'missing_schedulable_work', targetFactId: 'T' }]);
  });
});
