import { describe, expect, it } from 'vitest';
import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { weeklyPlanningCapacityShortfallText } from '../dialogue/weeklyPlanningCapacityShortfallDisclosure';
import { capacityShortfallFromPreview } from './weeklyPlanningCapacityShortfall';

type Item = { id: string; taskId: string; label: string; amount: number; unitCode: string; unitLabel: string; minutes: number | null };
const input = (items: Item[]) => ({
  movableWorkItems: items.map(item => ({
    id: item.id, taskId: item.taskId, label: item.label, estimatedMinutes: item.minutes,
    quantity: { amount: item.amount, unitCode: item.unitCode, unitLabel: item.unitLabel, ordinalRange: null, actualRange: null },
  })),
}) as unknown as GenericSchedulerInput;
const preview = (ids: string[], status = 'insufficient_capacity') => ({ status, unscheduledWorkItemIds: ids });
const physics = (n: number): Item => ({ id: `p${n}`, taskId: 'physics', label: `物理 10問（${n}〜${n + 9}問）`, amount: 10, unitCode: 'problem', unitLabel: '問', minutes: 60 });

describe('capacityShortfallFromPreview', () => {
  it('is null unless the preview ran out of capacity', () => {
    expect(capacityShortfallFromPreview({ preview: preview(['p1'], 'ready'), schedulerInput: input([physics(1)]) })).toBeNull();
    expect(capacityShortfallFromPreview({ preview: undefined, schedulerInput: input([physics(1)]) })).toBeNull();
    expect(capacityShortfallFromPreview({ preview: preview([]), schedulerInput: input([physics(1)]) })).toBeNull();
  });
  it('sums the unmet items per task, names the task by its title and keeps the plan total', () => {
    const items = [physics(1), physics(11), { ...physics(21), taskId: 'math', label: '数学 10問', id: 'm1' }];
    const result = capacityShortfallFromPreview({
      preview: preview(['p1', 'p11']), schedulerInput: input(items), taskTitleById: new Map([['physics', '物理・力学']]),
    })!;
    expect(result).toEqual({ requiredMinutes: 180, unmetMinutes: 120, unmetWork: [{ label: '物理・力学', quantity: '20問', minutes: 120 }], moreCount: 0 });
  });
  it('digit-echo: a unit label that echoes the amount never becomes the quantity phrase', () => {
    const echo: Item = { id: 'e', taskId: 't', label: '読書', amount: 180, unitCode: 'custom', unitLabel: '3時間', minutes: 180 };
    expect(capacityShortfallFromPreview({ preview: preview(['e']), schedulerInput: input([echo]) })!.unmetWork[0].quantity).toBe('');
    const page: Item = { ...echo, unitCode: 'page', unitLabel: '220ページ', amount: 30 };
    expect(capacityShortfallFromPreview({ preview: preview(['e']), schedulerInput: input([page]) })!.unmetWork[0].quantity).toBe('30ページ');
    const hours: Item = { ...echo, unitCode: 'hour', unitLabel: '3時間', amount: 3 };
    expect(capacityShortfallFromPreview({ preview: preview(['e']), schedulerInput: input([hours]) })!.unmetWork[0].quantity).toBe('3時間');
  });
  it('mixed units of one task state no quantity; more than five tasks are counted, not listed', () => {
    const mixed = [physics(1), { ...physics(11), unitCode: 'page', unitLabel: 'ページ' }];
    expect(capacityShortfallFromPreview({ preview: preview(['p1', 'p11']), schedulerInput: input(mixed) })!.unmetWork[0].quantity).toBe('');
    const many = Array.from({ length: 7 }, (_, i) => ({ ...physics(1), id: `x${i}`, taskId: `t${i}` }));
    const result = capacityShortfallFromPreview({ preview: preview(many.map(i => i.id)), schedulerInput: input(many) })!;
    expect(result.unmetWork).toHaveLength(5);
    expect(result.moreCount).toBe(2);
  });
});

describe('weeklyPlanningCapacityShortfallText', () => {
  it('states what did not fit and the plan total, never free minutes or a shortfall', () => {
    const text = weeklyPlanningCapacityShortfallText({
      requiredMinutes: 1808, unmetMinutes: 720, moreCount: 1,
      unmetWork: [{ label: '物理・力学', quantity: '120問', minutes: 720 }, { label: '古文', quantity: '60分', minutes: 60 }],
    });
    expect(text).toBe('入りきらなかった作業: 物理・力学（120問・約720分）、古文（60分）、ほか1件。今回の計画に必要な時間は合計1,808分です。');
    expect(text).not.toMatch(/足りない|不足|空き時間は/);
  });
});
