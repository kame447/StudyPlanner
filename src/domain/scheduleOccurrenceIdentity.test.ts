import { describe, expect, it } from 'vitest';
import type { Plan, ScheduleTemplate, TimetableTerm } from '../types/domain';
import { createScheduleOccurrenceProjection } from './scheduleOccurrence';

const TIMESTAMP = '2026-09-01T00:00:00.000Z';

function term(overrides: Partial<TimetableTerm> = {}): TimetableTerm {
  return {
    id: 'term-1',
    userId: 'user-1',
    year: 2026,
    kind: 'custom',
    label: '前期',
    startDate: '2026-04-01',
    endDate: '2026-07-31',
    isActive: true,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function template(overrides: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return {
    id: 'class-1',
    userId: 'user-1',
    title: '情報学演習',
    subject: '情報学',
    type: 'school-event',
    weekday: 'mon',
    startTime: '09:00',
    endTime: '10:00',
    termId: 'term-1',
    periodNumber: 1,
    classroom: '',
    memo: '',
    active: true,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function importedPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'imported-plan-1',
    seriesId: 'imported-plan-1',
    userId: 'user-1',
    title: '情報学演習',
    subject: '情報学',
    date: '2026-04-06',
    startTime: '09:15',
    endTime: '10:15',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'school-event',
    memo: '',
    sourceType: 'timetable',
    sourceId: 'class-1',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

describe('schedule occurrence logical identity', () => {
  it('prefers the persisted imported Plan even when its clock time differs from the template', () => {
    const activeTerm = term();
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      plans: [importedPlan()],
      scheduleTemplates: [template()],
      timetableTermId: activeTerm.id,
      timetableTerm: activeTerm,
      timetableTerms: [activeTerm],
    });

    expect(projection.issues).toEqual([]);
    expect(projection.occurrences).toHaveLength(1);
    expect(projection.occurrences[0]).toMatchObject({
      start: { date: '2026-04-06', time: '09:15' },
      end: { date: '2026-04-06', time: '10:15' },
      source: {
        kind: 'timetable',
        id: 'class-1',
        backingKind: 'plan',
        backingId: 'imported-plan-1',
      },
    });
  });

  it('fails the timetable projection closed when a term belongs to another owner', () => {
    const foreignTerm = term({ userId: 'user-2' });
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      plans: [],
      scheduleTemplates: [template()],
      timetableTermId: foreignTerm.id,
      timetableTerm: foreignTerm,
      timetableTerms: [foreignTerm],
    });

    expect(projection.occurrences).toEqual([]);
    expect(projection.issues).toContainEqual({
      code: 'owner_mismatch',
      sourceKind: 'timetable',
      sourceId: 'term-1',
    });
  });
});
