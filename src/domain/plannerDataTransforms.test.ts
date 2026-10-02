import { describe, expect, it } from 'vitest';
import type { ScheduleTemplate, StudyMaterial, TimetablePeriod, TimetableTerm } from '../types/domain';
import { normalizePlannerTimetableData, resolveActualMaterialProgress } from './plannerDataTransforms';

const createdAt = '2026-04-01T00:00:00.000Z';
const now = '2026-10-02T12:00:00.000Z';

function term(overrides: Partial<TimetableTerm> = {}): TimetableTerm {
  return {
    id: '2026-first', userId: 'owner', year: 2026, kind: 'firstHalf',
    label: '2026年 前期', isActive: true, createdAt, updatedAt: createdAt,
    ...overrides,
  };
}

function template(overrides: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return {
    id: 'template', userId: 'owner', title: '数学', subject: '数学', type: 'study',
    weekday: 'mon', startTime: '09:00', endTime: '10:00', termId: '2026-first',
    memo: '', active: true, createdAt, updatedAt: createdAt, ...overrides,
  };
}

function period(overrides: Partial<TimetablePeriod> = {}): TimetablePeriod {
  return {
    id: 'period', userId: 'owner', termId: '2026-first', periodNumber: 1,
    label: '1限', startTime: '09:00', endTime: '10:00', createdAt,
    updatedAt: createdAt, ...overrides,
  };
}

function material(overrides: Partial<StudyMaterial> = {}): StudyMaterial {
  return {
    id: 'material', userId: 'owner', name: '数学問題集', subjectId: 'math',
    subjectName: '数学', paceEnabled: true, progressUnit: 'problem',
    totalUnits: 100, currentUnit: 10, createdAt, updatedAt: createdAt,
    ...overrides,
  };
}

describe('normalizePlannerTimetableData', () => {
  it('creates the default term using the supplied time, including its year', () => {
    const timestamp = '2004-07-01T12:00:00.000Z';
    const result = normalizePlannerTimetableData('owner', {
      timetableTerms: [], timetablePeriods: [], scheduleTemplates: [],
    }, timestamp);

    expect(result.timetableTerms).toEqual([{
      id: '2004-full-year', userId: 'owner', year: 2004, kind: 'fullYear',
      label: '2004年 通年', isActive: true, createdAt: timestamp, updatedAt: timestamp,
    }]);
    expect(result.mutation).toEqual({
      userId: 'owner', termUpserts: result.timetableTerms, termDeletes: [],
      templateUpserts: [], templateDeletes: [], periodUpserts: [], periodDeletes: [],
    });
  });

  it('also uses the supplied year for non-finite legacy years', () => {
    const result = normalizePlannerTimetableData('owner', {
      timetableTerms: [term({ id: 'legacy', year: NaN })],
      timetablePeriods: [], scheduleTemplates: [],
    }, '2004-07-01T12:00:00.000Z');
    expect(result.timetableTerms[0]).toMatchObject({ id: '2004-first', label: '2004年 前期' });
  });

  it('collapses legacy terms, remaps references and deletes only losing periods without mutating input', () => {
    const source = {
      timetableTerms: [
        term({ id: 'legacy-active' }),
        term({ id: 'legacy-newer', isActive: false, startDate: '2026-05-01', updatedAt: '2026-05-01T00:00:00.000Z' }),
        term({ id: 'custom', kind: 'custom', label: '集中講義', isActive: false }),
      ],
      scheduleTemplates: [
        template({ id: 'default-template', termId: undefined }),
        template({ id: 'legacy-template', termId: 'legacy-newer' }),
        template({ id: 'custom-template', termId: 'custom' }),
        template({ id: 'unknown-template', termId: 'unknown' }),
      ],
      timetablePeriods: [
        period({ id: 'canonical-old' }),
        period({ id: 'remapped-first', termId: 'legacy-active' }),
        period({ id: 'remapped-tie', termId: 'legacy-newer' }),
        period({ id: 'second', periodNumber: 2 }),
      ],
    };
    const snapshot = structuredClone(source);
    const result = normalizePlannerTimetableData('owner', source, now);

    expect(source).toEqual(snapshot);
    expect(result.timetableTerms.map((item) => item.id)).toEqual(['2026-first', 'custom']);
    expect(result.mutation.termUpserts).toEqual([expect.objectContaining({
      id: '2026-first', isActive: true, startDate: '2026-05-01', updatedAt: now,
    })]);
    expect(result.mutation.termDeletes).toEqual(source.timetableTerms.slice(0, 2));
    expect(result.mutation.templateUpserts).toEqual(source.scheduleTemplates.slice(0, 2).map((item) => ({
      ...item, termId: '2026-first', updatedAt: now,
    })));
    expect(result.scheduleTemplates[2]).toBe(source.scheduleTemplates[2]);
    expect(result.scheduleTemplates[3]).toBe(source.scheduleTemplates[3]);
    expect(result.timetablePeriods.map((item) => item.id)).toEqual(['remapped-first', 'second']);
    expect(result.mutation.periodUpserts).toEqual([{
      ...source.timetablePeriods[1], termId: '2026-first', updatedAt: now,
    }]);
    expect(result.mutation.periodDeletes).toEqual([source.timetablePeriods[0], source.timetablePeriods[2]]);
    expect(result.mutation.templateDeletes).toEqual([]);

    const repeated = normalizePlannerTimetableData('owner', result, '2026-10-03T12:00:00.000Z');
    expect(repeated.mutation).toEqual({
      userId: 'owner', termUpserts: [], termDeletes: [], templateUpserts: [],
      templateDeletes: [], periodUpserts: [], periodDeletes: [],
    });
  });

  it('keeps canonical timestamps and references when no persistence changes are needed', () => {
    const source = {
      timetableTerms: [term()], timetablePeriods: [period()], scheduleTemplates: [template()],
    };
    const result = normalizePlannerTimetableData('owner', source, now);
    expect(result.timetableTerms).toEqual(source.timetableTerms);
    expect(result.scheduleTemplates[0]).toBe(source.scheduleTemplates[0]);
    expect(result.timetablePeriods[0]).toBe(source.timetablePeriods[0]);
    expect(result.mutation).toEqual({
      userId: 'owner', termUpserts: [], termDeletes: [], templateUpserts: [],
      templateDeletes: [], periodUpserts: [], periodDeletes: [],
    });
  });

  it.each([
    { startDate: '2026-04-15' },
    { endDate: '2026-09-15' },
    { usesAlternatingWeeks: true },
    { alternatingWeekAnchorDate: '2026-04-06' },
  ])('persists merged term field changes: %j', (change) => {
    const result = normalizePlannerTimetableData('owner', {
      timetableTerms: [term(), term({ id: 'legacy-newer', updatedAt: now, ...change })],
      timetablePeriods: [], scheduleTemplates: [],
    }, now);
    expect(result.mutation.termUpserts).toEqual([expect.objectContaining({ id: '2026-first', ...change })]);
  });

  it('persists label and active-term repairs even when ids are already canonical', () => {
    const result = normalizePlannerTimetableData('owner', {
      timetableTerms: [term({ label: '旧ラベル', isActive: false })],
      timetablePeriods: [], scheduleTemplates: [],
    }, now);
    expect(result.mutation.termUpserts).toEqual([term()]);
  });
});

describe('resolveActualMaterialProgress', () => {
  it.each([undefined, []])('preserves the materials array for absent progress (%j)', (materialProgressUpdates) => {
    const materials = [material()];
    const result = resolveActualMaterialProgress(materials, { materialProgressUpdates }, now);
    expect(result.nextMaterials).toBe(materials);
    expect(result.changedMaterials).toEqual([]);
  });

  it('applies updates sequentially, clamps progress and selects only actual unit changes', () => {
    const materials = [
      material(), material({ id: 'completed', currentUnit: 100 }),
      material({ id: 'disabled', paceEnabled: false }), material({ id: 'untouched' }),
    ];
    const snapshot = structuredClone(materials);
    const result = resolveActualMaterialProgress(materials, { materialProgressUpdates: [
      { materialId: 'material', deltaUnits: 5 },
      { materialId: 'material', deltaUnits: 10 },
      { materialId: 'completed', deltaUnits: 10 },
      { materialId: 'disabled', toUnit: 30 },
      { materialId: 'missing', toUnit: 30 },
    ] }, now);

    expect(materials).toEqual(snapshot);
    expect(result.nextMaterials.map((item) => item.currentUnit)).toEqual([25, 100, 10, 10]);
    expect(result.changedMaterials).toEqual([{ ...materials[0], currentUnit: 25, updatedAt: now }]);
    expect(result.nextMaterials[2]).toBe(materials[2]);
    expect(result.nextMaterials[3]).toBe(materials[3]);
  });

  it('does not select invalid, timestamp-only or net-zero updates for persistence', () => {
    const materials = [material(), material({ id: 'invalid' }), material({ id: 'no-change' })];
    const result = resolveActualMaterialProgress(materials, { materialProgressUpdates: [
      { materialId: 'material', deltaUnits: 5 },
      { materialId: 'material', toUnit: 10 },
      { materialId: 'invalid', deltaUnits: NaN },
      { materialId: 'no-change', deltaUnits: 0 },
    ] }, now);
    expect(result.changedMaterials).toEqual([]);
    expect(result.nextMaterials[0]).toEqual({ ...materials[0], updatedAt: now });
    expect(result.nextMaterials[1]).toBe(materials[1]);
  });
});
