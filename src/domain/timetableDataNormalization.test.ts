import { describe, expect, it } from 'vitest';
import type { TimetablePeriod, TimetableTerm } from '../types/domain';
import {
  createTimetableTermId,
  createTimetableTermLabel,
  mergeTimetablePeriodsByTermAndNumber,
  normalizeTimetableDate,
  normalizeTimetableTermsByYearAndKind,
  remapTimetableTermId,
  sortTimetableTerms,
} from './timetableDataNormalization';

function term(overrides: Partial<TimetableTerm> = {}): TimetableTerm {
  return {
    id: 'legacy-first',
    userId: 'owner-a',
    year: 2026,
    kind: 'firstHalf',
    label: '旧ラベル',
    startDate: '2026-04-01',
    endDate: '2026-09-30',
    isActive: false,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function period(overrides: Partial<TimetablePeriod> = {}): TimetablePeriod {
  return {
    id: 'period-1',
    userId: 'owner-a',
    termId: '2026-first',
    periodNumber: 1,
    label: '1限',
    startTime: '09:00',
    endTime: '10:30',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('timetable data normalization', () => {
  it('owns stable term ids and labels', () => {
    expect(createTimetableTermId(2026, 'firstHalf')).toBe('2026-first');
    expect(createTimetableTermId(2026, 'fullYear')).toBe('2026-full-year');
    expect(createTimetableTermLabel(2026, 'secondHalf')).toBe('2026年 後期');
    expect(createTimetableTermLabel(2026, 'custom', ' 集中講義 ')).toBe('集中講義');
  });

  it('accepts only real ISO calendar dates', () => {
    expect(normalizeTimetableDate('2026-02-28')).toBe('2026-02-28');
    expect(normalizeTimetableDate('2026-02-29')).toBeNull();
    expect(normalizeTimetableDate('2026-13-01')).toBeNull();
    expect(normalizeTimetableDate(' 2026-04-01 ')).toBe('2026-04-01');
  });

  it('collapses duplicate non-custom terms onto one stable id while preserving the active source group', () => {
    const normalized = normalizeTimetableTermsByYearAndKind('owner-b', [
      term({
        id: 'legacy-active',
        isActive: true,
        label: '古い前期',
        updatedAt: '2026-04-01T00:00:00.000Z',
      }),
      term({
        id: 'legacy-newer',
        isActive: false,
        label: '新しい前期',
        updatedAt: '2026-05-01T00:00:00.000Z',
      }),
      term({
        id: 'custom-summer',
        kind: 'custom',
        label: '夏季集中',
        startDate: '2026-08-01',
        isActive: false,
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
    ]);

    expect(normalized.terms).toHaveLength(2);
    expect(normalized.terms[0]).toEqual(expect.objectContaining({
      id: '2026-first',
      userId: 'owner-b',
      label: '2026年 前期',
      isActive: true,
    }));
    expect(normalized.terms.find((item) => item.id === 'custom-summer')).toEqual(
      expect.objectContaining({ label: '夏季集中', userId: 'owner-b', isActive: false }),
    );
    expect(normalized.termIdMap.get('legacy-active')).toBe('2026-first');
    expect(normalized.termIdMap.get('legacy-newer')).toBe('2026-first');
    expect(normalized.termIdMap.get('default')).toBe('2026-first');
    expect(normalized.obsoleteTermIds).toEqual(expect.arrayContaining([
      'legacy-active',
      'legacy-newer',
    ]));
  });

  it('remaps legacy/default ids and preserves unknown ids', () => {
    const mapping = new Map([
      ['default', '2026-first'],
      ['legacy', '2026-first'],
    ]);

    expect(remapTimetableTermId(undefined, mapping)).toBe('2026-first');
    expect(remapTimetableTermId('legacy', mapping)).toBe('2026-first');
    expect(remapTimetableTermId('custom-id', mapping)).toBe('custom-id');
  });

  it('keeps the newest duplicate period for each term and period number', () => {
    const merged = mergeTimetablePeriodsByTermAndNumber([
      period({ id: 'old', updatedAt: '2026-04-01T00:00:00.000Z' }),
      period({ id: 'new', label: '第1時限', updatedAt: '2026-05-01T00:00:00.000Z' }),
      period({ id: 'second', periodNumber: 2, label: '2限' }),
    ]);

    expect(merged.periods.map((item) => item.id)).toEqual(['new', 'second']);
    expect(merged.obsoletePeriodIds).toEqual(['old']);
  });

  it('sorts the active term first and then by period recency rules', () => {
    const sorted = sortTimetableTerms([
      term({ id: 'older', year: 2025, startDate: '2025-10-01' }),
      term({ id: 'active', year: 2024, startDate: '2024-04-01', isActive: true }),
      term({ id: 'newer', year: 2026, startDate: '2026-04-01' }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['active', 'newer', 'older']);
  });
});
