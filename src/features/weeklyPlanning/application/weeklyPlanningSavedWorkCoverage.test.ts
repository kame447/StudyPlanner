import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import { buildWeeklyPlanningPlanSourceId } from '../planning/weeklyPlanningPlanProvenance';
import { workNotCoveredBySavedPlans } from './weeklyPlanningSavedWorkCoverage';

const item = (id: string, estimatedMinutes: number | null, label = '数学 60分') => ({ id, estimatedMinutes, label });
const saved = (blockId: string, startTime: string, endTime: string, over: Partial<Plan> = {}): Plan => ({
  id: `plan:${blockId}`, seriesId: `plan:${blockId}`, userId: 'u', title: '無関係な題名', subject: '', type: 'study', date: '2026-11-03',
  startTime, endTime, memo: '', recurrence: null, recurrenceRules: [], excludedDates: [], createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
  sourceType: 'weekly-planning', sourceId: buildWeeklyPlanningPlanSourceId({ approvalOperationId: 'op', sourceDraftBlockId: blockId }), ...over,
} as Plan);

describe('work an approved plan already covers is not unplaced (D1)', () => {
  it('covers an item by the identity in the saved block id, across split blocks and graph revisions', () => {
    const plans = [saved('stable-v5:4:work-a:0', '21:00', '21:30'), saved('stable-v5:4:work-a:1', '22:00', '22:30')];
    expect(workNotCoveredBySavedPlans([item('work-a', 60)], plans)).toEqual([]);
  });

  it('never matches by title: a plan titled like the work but saved from another item covers nothing', () => {
    const plans = [saved('stable-v5:4:work-b:0', '21:00', '22:00', { title: '数学 60分' })];
    expect(workNotCoveredBySavedPlans([item('work-a', 60)], plans)).toEqual([item('work-a', 60)]);
  });

  it('keeps the remainder unplaced when a later correction raised the amount beyond what was saved', () => {
    const plans = [saved('stable-v5:4:work-a:0', '21:00', '22:00')];
    expect(workNotCoveredBySavedPlans([item('work-a', 90)], plans)).toEqual([item('work-a', 90)]);
  });

  it('ignores plans that were not saved by weekly planning, fixed-event registrations and unreadable provenance', () => {
    const plans = [saved('stable-v5:4:work-a:0', '21:00', '22:00', { sourceType: 'manual' as never }),
      saved('stable-v5:4:work-a', '21:00', '22:00'), saved('not-a-candidate-id', '21:00', '22:00'),
      saved('stable-v5:4:work-a:0', '21:00', '22:00', { sourceId: 'garbage' })];
    expect(workNotCoveredBySavedPlans([item('work-a', 60)], plans)).toEqual([item('work-a', 60)]);
  });

  it('treats an item without a known estimate as not covered, and leaves unrelated items awaiting', () => {
    const plans = [saved('stable-v5:4:work-a:0', '21:00', '22:00')];
    expect(workNotCoveredBySavedPlans([item('work-a', null), item('work-c', 30)], plans)).toEqual([item('work-a', null), item('work-c', 30)]);
  });
});
