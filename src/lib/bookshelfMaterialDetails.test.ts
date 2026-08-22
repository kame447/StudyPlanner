import { describe, expect, it } from 'vitest';
import {
  buildMaterialActivitySummary,
  getCurrentStructureItem,
  getStructureItemProgress,
  isRecordForMaterial,
  type MaterialStructureItem,
} from './bookshelfMaterialDetails';
import type { Actual, Plan, StudyMaterial } from '../types/domain';

const material: StudyMaterial = {
  id: 'material-1',
  userId: 'user-1',
  name: 'アルゴリズム問題集',
  subjectId: 'subject-1',
  subjectName: '情報',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function createPlan(
  id: string,
  date: string,
  startTime: string,
  endTime: string,
  materialId: string | null = material.id,
): Plan {
  return {
    id,
    seriesId: id,
    userId: 'user-1',
    title: '問題演習',
    subject: '情報',
    date,
    startTime,
    endTime,
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    materialId,
    materialName: material.name,
  };
}

function createActual(
  id: string,
  occurrenceDate: string,
  startTime: string,
  endTime: string,
): Actual {
  return {
    id,
    userId: 'user-1',
    planId: null,
    occurrenceDate,
    actualStartTime: startTime,
    actualEndTime: endTime,
    title: '問題演習',
    subject: '情報',
    isAlignedToPlan: false,
    note: '',
    updatedAt: '2026-08-01T00:00:00.000Z',
    materialId: material.id,
    materialName: material.name,
  };
}

describe('bookshelfMaterialDetails', () => {
  it('uses material id as the authoritative link and falls back to the saved material name', () => {
    expect(
      isRecordForMaterial({ materialId: material.id, materialName: '旧名称' }, material),
    ).toBe(true);
    expect(
      isRecordForMaterial({ materialId: 'other-material', materialName: material.name }, material),
    ).toBe(false);
    expect(
      isRecordForMaterial({ materialId: null, materialName: material.name }, material),
    ).toBe(true);
  });

  it('summarizes linked study time and keeps upcoming plans in chronological order', () => {
    const plans = [
      createPlan('plan-future-2', '2026-08-23', '19:00', '20:30'),
      createPlan('plan-past', '2026-08-19', '09:00', '10:00'),
      createPlan('plan-future-1', '2026-08-22', '18:00', '19:00'),
      createPlan('plan-other', '2026-08-22', '20:00', '21:00', 'other-material'),
    ];
    const actuals = [
      createActual('actual-old', '2026-08-18', '10:00', '10:30'),
      createActual('actual-new', '2026-08-20', '12:00', '13:15'),
    ];

    const summary = buildMaterialActivitySummary(
      material,
      plans,
      actuals,
      '2026-08-21',
    );

    expect(summary.actualMinutes).toBe(105);
    expect(summary.plannedMinutes).toBe(210);
    expect(summary.sessionCount).toBe(2);
    expect(summary.lastStudyDate).toBe('2026-08-20');
    expect(summary.recentActuals.map((actual) => actual.id)).toEqual([
      'actual-new',
      'actual-old',
    ]);
    expect(summary.upcomingPlans.map((plan) => plan.id)).toEqual([
      'plan-future-1',
      'plan-future-2',
    ]);
  });

  it('derives structure progress from the current unit and selects the first incomplete item', () => {
    const items: MaterialStructureItem[] = [
      { id: 'part-1', title: '基礎', startUnit: 0, endUnit: 50 },
      { id: 'part-2', title: '応用', startUnit: 50, endUnit: 100 },
    ];

    expect(getStructureItemProgress(items[0], 75)).toBe(100);
    expect(getStructureItemProgress(items[1], 75)).toBe(50);
    expect(getCurrentStructureItem(items, 75)?.id).toBe('part-2');
  });

  it('prefers an explicit progress override and clamps it to a valid percentage', () => {
    expect(
      getStructureItemProgress(
        { id: 'part', title: '手動進捗', progressRate: 130 },
        0,
      ),
    ).toBe(100);
    expect(
      getStructureItemProgress(
        { id: 'part', title: '手動進捗', progressRate: -20 },
        0,
      ),
    ).toBe(0);
  });
});
