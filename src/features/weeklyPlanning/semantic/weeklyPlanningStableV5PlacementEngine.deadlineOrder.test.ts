import { describe, expect, it } from 'vitest';
import { deadlineFirstOrder } from './weeklyPlanningStableV5PlacementEngine';

const item = (id: string, taskId: string) => ({ id, taskId, workloadFactId: `w-${id}`, componentId: null }) as never;
const bound = (taskId: string, endDate: string | null, targetFactId = taskId) => ({ taskId, targetFactId, startDate: null, endDate, sourceFactIds: [] });

describe('deadlineFirstOrder', () => {
  it('puts the earliest hard deadline first, ties and deadline-less items keep the canonical order', () => {
    const items = [item('a', 'ta'), item('b', 'tb'), item('c', 'tc'), item('d', 'td'), item('e', 'te')];
    const input = { hardDateBounds: [bound('ta', '2026-10-18'), bound('tb', '2026-10-16'), bound('td', '2026-10-18'), bound('te', '2026-10-16')] } as never;
    expect(deadlineFirstOrder(items, input).map(x => (x as { id: string }).id)).toEqual(['b', 'e', 'a', 'd', 'c']);
  });
  it('ignores a bound on another fact of the task and a bound without an end date', () => {
    const items = [item('a', 'ta'), item('b', 'tb')];
    const input = { hardDateBounds: [bound('tb', '2026-10-16', 'other-fact'), bound('tb', null)] } as never;
    expect(deadlineFirstOrder(items, input).map(x => (x as { id: string }).id)).toEqual(['a', 'b']);
  });
});
