import { describe, expect, it } from 'vitest';
import type { ScheduleTemplate, TimetablePeriod, TimetableTerm } from '../types/domain';
import { normalizePlannerTimetableData } from './plannerDataTransforms';
import { createTimetableTermId, normalizeTimetableTermsByYearAndKind } from './timetableDataNormalization';

const stamp = '2026-10-05T00:00:00.000Z';
const owner = 'affected-owner';
const scopedId = 'timetable-term:YWZmZWN0ZWQtb3duZXI:2026-full-year';
const empty = { timetableTerms: [], scheduleTemplates: [], timetablePeriods: [] };
function term(overrides: Partial<TimetableTerm> = {}): TimetableTerm {
  return { id: '2026-full-year', userId: owner, year: 2026, kind: 'fullYear', label: '2026年 通年',
    isActive: true, createdAt: stamp, updatedAt: stamp, ...overrides };
}
function template(index = 0, overrides: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return { id: `template-${index}`, userId: owner, title: 'Synthetic course', subject: 'Study', type: 'study',
    weekday: 'mon', startTime: '09:00', endTime: '10:00', termId: '2026-full-year', memo: '',
    active: true, createdAt: stamp, updatedAt: stamp, ...overrides };
}
function period(overrides: Partial<TimetablePeriod> = {}): TimetablePeriod {
  return { id: 'period', userId: owner, termId: '2026-full-year', periodNumber: 1, label: '1',
    startTime: '09:00', endTime: '10:00', createdAt: stamp, updatedAt: stamp, ...overrides };
}

describe('owner-scoped timetable identity', () => {
  it('encodes owners injectively without trimming and stays below the document ID byte limit', () => {
    const owners = ['owner', ' owner', 'owner ', 'owner:2026-full-year', 'owner/one', 'owner%2Fone',
      'owner\\one', '\uFEFFowner', '教員', 'é', 'e\u0301', '😀'.repeat(128), 'a'.repeat(128)];
    const ids = owners.map((uid) => createTimetableTermId(uid, 2026, 'fullYear', stamp));
    expect(new Set(ids).size).toBe(owners.length);
    for (const [index, id] of ids.entries()) {
      expect(id).not.toContain('/');
      expect(new TextEncoder().encode(id).length).toBeLessThanOrEqual(1500);
      expect(id).toBe(createTimetableTermId(owners[index], 2026, 'fullYear', stamp));
      const encodedOwner = id.split(':')[1].replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(encodedOwner), (character) => character.charCodeAt(0));
      expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(owners[index]);
    }
  });

  it.each(['', 'a'.repeat(129), '\uD800', '\uDC00'])('rejects an invalid owner without folding it into another owner', (uid) => {
    expect(() => createTimetableTermId(uid, 2026, 'fullYear', stamp)).toThrow('valid owner UID');
  });

  it('recovers six orphaned legacy references without touching a foreign canonical document', () => {
    const source = { ...empty, scheduleTemplates: Array.from({ length: 6 }, (_, index) => template(index)) };
    const snapshot = structuredClone(source);
    const result = normalizePlannerTimetableData(owner, source, stamp);
    expect(result.timetableTerms[0].id).toBe(scopedId);
    expect(result.mutation.termUpserts).toHaveLength(1);
    expect(result.mutation.templateUpserts).toHaveLength(6);
    expect(result.mutation.templateUpserts.map((row) => row.termId)).toEqual(Array(6).fill(scopedId));
    expect(result.mutation.termDeletes).toEqual([]);
    expect(result.mutation.periodUpserts).toEqual([]);
    expect(result.mutation.periodDeletes).toEqual([]);
    expect(result.mutation.templateDeletes).toEqual([]);
    expect(source).toEqual(snapshot);
    const repeated = normalizePlannerTimetableData(owner, result, '2026-10-06T00:00:00.000Z');
    expect(repeated.mutation).toEqual({ userId: owner, termUpserts: [], termDeletes: [],
      templateUpserts: [], templateDeletes: [], periodUpserts: [], periodDeletes: [] });
  });

  it('migrates only owned legacy terms and remaps their template/period references in the same patch', () => {
    const source = { timetableTerms: [term()], scheduleTemplates: [template()], timetablePeriods: [period()] };
    const result = normalizePlannerTimetableData(owner, source, '2026-10-06T00:00:00.000Z');
    expect(result.mutation.termDeletes).toEqual(source.timetableTerms);
    expect(result.mutation.termUpserts[0]).toMatchObject({ id: scopedId, userId: owner, createdAt: stamp });
    expect(result.mutation.templateUpserts[0]).toMatchObject({ id: 'template-0', termId: scopedId });
    expect(result.mutation.periodUpserts[0]).toMatchObject({ id: 'period', termId: scopedId });
  });

  it('maps old canonical aliases even when owned term records use older random IDs', () => {
    const result = normalizePlannerTimetableData(owner, {
      timetableTerms: [term({ id: 'older-random-id' })], scheduleTemplates: [template()], timetablePeriods: [period()],
    }, stamp);
    expect(result.scheduleTemplates[0].termId).toBe(scopedId);
    expect(result.timetablePeriods[0].termId).toBe(scopedId);
    expect(result.mutation.termDeletes.map((row) => row.id)).toEqual(['older-random-id']);
  });

  it('preserves custom IDs and unknown references, including explicit custom IDs that resemble legacy aliases', () => {
    const custom = term({ id: '2026-full-year', kind: 'custom', label: 'Custom course' });
    const result = normalizePlannerTimetableData(owner, {
      timetableTerms: [custom, term({ id: 'old-standard', isActive: false })],
      scheduleTemplates: [template(), template(1, { termId: 'unknown' })],
      timetablePeriods: [period()],
    }, stamp);
    expect(result.timetableTerms.find((row) => row.kind === 'custom')).toEqual(custom);
    expect(result.scheduleTemplates.map((row) => row.termId)).toEqual(['2026-full-year', 'unknown']);
    expect(result.timetablePeriods[0].termId).toBe('2026-full-year');
    expect(result.mutation.termDeletes.map((row) => row.id)).toEqual(['old-standard']);
  });

  it('fails closed if a custom ID occupies the new standard canonical identity', () => {
    expect(() => normalizePlannerTimetableData(owner, {
      ...empty, timetableTerms: [term({ id: scopedId, kind: 'custom' }), term()],
    }, stamp)).toThrow('conflicts with a custom');
  });

  it.each(['term', 'template', 'period'] as const)('rejects a foreign %s before creating any migration patch', (kind) => {
    const source = {
      timetableTerms: [term(kind === 'term' ? { userId: 'foreign' } : {})],
      scheduleTemplates: [template(0, kind === 'template' ? { userId: 'foreign' } : {})],
      timetablePeriods: [period(kind === 'period' ? { userId: 'foreign' } : {})],
    };
    const snapshot = structuredClone(source);
    expect(() => normalizePlannerTimetableData(owner, source, stamp)).toThrow('another owner');
    expect(source).toEqual(snapshot);
  });

  it('does not reassign foreign owners even through the lower-level term normalizer', () => {
    expect(() => normalizeTimetableTermsByYearAndKind('other', [term()], stamp)).toThrow('another owner');
  });
});
