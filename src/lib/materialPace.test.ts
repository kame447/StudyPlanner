import { describe, expect, it } from 'vitest';
import {
  applyMaterialProgressUpdate,
  applyMaterialProgressUpdates,
  calculateNextMaterialUnit,
  calculateDailyQuota,
  calculateMaterialPace,
  getMaterialUnitLabel,
  getRemainingUnits,
} from './materialPace';
import type { StudyMaterial } from '../types/domain';

function material(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id: 'material-1',
    userId: 'user-1',
    name: '問題集',
    subjectId: 'subject-1',
    subjectName: '数学',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    paceEnabled: true,
    progressUnit: 'problem',
    totalUnits: 100,
    currentUnit: 20,
    targetDate: '2026-05-08',
    ...overrides,
  };
}

describe('materialPace', () => {
  it('calculates daily quota from remaining units and inclusive remaining days', () => {
    const result = calculateMaterialPace(material(), '2026-05-01');

    expect(result.remainingUnits).toBe(80);
    expect(result.remainingDays).toBe(8);
    expect(result.dailyQuota).toBe(10);
    expect(result.suggestedDailyUnits).toBe(10);
    expect(calculateDailyQuota(material(), '2026-05-01')).toBe(10);
  });

  it('returns no-target when targetDate is not set', () => {
    const result = calculateMaterialPace(
      material({ targetDate: undefined }),
      '2026-05-01',
    );

    expect(result.status).toBe('no-target');
    expect(result.dailyQuota).toBeNull();
    expect(result.remainingUnits).toBe(80);
  });

  it('returns completed when currentUnit equals totalUnits', () => {
    const result = calculateMaterialPace(
      material({ currentUnit: 100 }),
      '2026-05-01',
    );

    expect(result.status).toBe('completed');
    expect(result.remainingUnits).toBe(0);
    expect(result.progressRate).toBe(100);
  });

  it('clamps remaining units to zero when currentUnit exceeds totalUnits', () => {
    const current = material({ currentUnit: 120 });

    expect(getRemainingUnits(current)).toBe(0);
    expect(calculateMaterialPace(current, '2026-05-01')).toMatchObject({
      status: 'completed',
      currentUnit: 100,
      remainingUnits: 0,
    });
  });

  it('returns overdue when targetDate is before today', () => {
    const result = calculateMaterialPace(
      material({ targetDate: '2026-04-30' }),
      '2026-05-01',
    );

    expect(result.status).toBe('overdue');
    expect(result.remainingDays).toBe(0);
    expect(result.dailyQuota).toBeNull();
  });

  it('uses custom unit label when configured', () => {
    const current = material({
      progressUnit: 'custom',
      progressUnitLabel: 'レッスン',
    });

    expect(getMaterialUnitLabel(current)).toBe('レッスン');
    expect(calculateMaterialPace(current, '2026-05-01').unitLabel).toBe(
      'レッスン',
    );
  });

  it('returns disabled when paceEnabled is false', () => {
    const result = calculateMaterialPace(
      material({ paceEnabled: false }),
      '2026-05-01',
    );

    expect(result.enabled).toBe(false);
    expect(result.status).toBe('disabled');
    expect(result.dailyQuota).toBeNull();
  });

  it('calculates estimated daily minutes from suggested units', () => {
    const result = calculateMaterialPace(
      material({
        totalUnits: 100,
        currentUnit: 21,
        targetDate: '2026-05-08',
        estimatedMinutesPerUnit: 6,
      }),
      '2026-05-01',
    );

    expect(result.dailyQuota).toBe(9.875);
    expect(result.suggestedDailyUnits).toBe(10);
    expect(result.estimatedDailyMinutes).toBe(60);
  });
});

describe('material progress updates', () => {
  it('adds deltaUnits to currentUnit', () => {
    expect(
      calculateNextMaterialUnit(material({ currentUnit: 10 }), {
        materialId: 'material-1',
        deltaUnits: 5,
      }),
    ).toBe(15);
  });

  it('uses toUnit as the next currentUnit', () => {
    expect(
      calculateNextMaterialUnit(material({ currentUnit: 10 }), {
        materialId: 'material-1',
        toUnit: 30,
      }),
    ).toBe(30);
  });

  it('prefers toUnit when both toUnit and deltaUnits are set', () => {
    expect(
      calculateNextMaterialUnit(material({ currentUnit: 10 }), {
        materialId: 'material-1',
        toUnit: 30,
        deltaUnits: 5,
      }),
    ).toBe(30);
  });

  it('clamps next currentUnit to totalUnits', () => {
    expect(
      calculateNextMaterialUnit(material({ currentUnit: 90, totalUnits: 100 }), {
        materialId: 'material-1',
        deltaUnits: 20,
      }),
    ).toBe(100);
  });

  it('does not go below zero', () => {
    expect(
      calculateNextMaterialUnit(material({ currentUnit: 10 }), {
        materialId: 'material-1',
        deltaUnits: -20,
      }),
    ).toBe(0);
  });

  it('does not update materials with pace disabled', () => {
    const current = material({ paceEnabled: false, currentUnit: 10 });

    expect(
      applyMaterialProgressUpdate(current, {
        materialId: 'material-1',
        deltaUnits: 5,
      }),
    ).toBe(current);
  });

  it('ignores updates for a different materialId', () => {
    const current = material({ currentUnit: 10 });

    expect(
      applyMaterialProgressUpdate(current, {
        materialId: 'material-other',
        deltaUnits: 5,
      }),
    ).toBe(current);
  });

  it('treats missing currentUnit as zero', () => {
    expect(
      calculateNextMaterialUnit(material({ currentUnit: undefined }), {
        materialId: 'material-1',
        deltaUnits: 5,
      }),
    ).toBe(5);
  });

  it('applies updates across a material list', () => {
    const nextMaterials = applyMaterialProgressUpdates(
      [
        material({ id: 'material-1', currentUnit: 10 }),
        material({ id: 'material-2', currentUnit: 20 }),
      ],
      [
        { materialId: 'material-1', deltaUnits: 5 },
        { materialId: 'missing', deltaUnits: 100 },
      ],
    );

    expect(nextMaterials[0].currentUnit).toBe(15);
    expect(nextMaterials[1].currentUnit).toBe(20);
  });
});
