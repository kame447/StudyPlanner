import { describe, expect, it } from 'vitest';
import { createScheduleOccurrenceProjection } from './scheduleOccurrence';
import { buildDayOccurrenceCancellation } from './dayOccurrenceCancellation';
import { normalizeScheduleTemplateRecord } from '../repositories/repositoryUtils';
import { buildTimetableImportCandidates } from '../lib/timetableImport';
import { normalizeStudyRecordsForDisplay, sumStudyRecordMinutes } from '../lib/studyRecords';
import type { Plan, MonthEvent, ScheduleTemplate, TimetableTerm } from '../types/domain';
const stamp = '2026-10-01T00:00:00Z', date = '2026-10-05';
const base = { userId: 'owner', createdAt: stamp, updatedAt: stamp };
const plan: Plan = { ...base, id: 'p', seriesId: 'p', title: 'Study', subject: 'Math', type: 'study', date,
  startTime: '09:00', endTime: '10:00', repeat: 'weekly', repeatUntil: null, excludedDates: [], recurrenceRules: [], memo: '' };
const event: MonthEvent = { ...base, id: 'e', title: 'Meeting', date, startTime: '12:00', endTime: '13:00',
  repeat: 'weekly', repeatUntil: null, excludedDates: [], memo: '', url: '', checklist: [], locationTags: [] };
const term: TimetableTerm = { ...base, id: 'term', year: 2026, kind: 'custom', label: 'Term', isActive: true,
  startDate: '2026-10-01', endDate: '2026-10-31' };
const template: ScheduleTemplate = { ...base, id: 't', title: 'Class', subject: 'Math', type: 'school-event', weekday: 'mon',
  startTime: '14:00', endTime: '15:00', periodNumber: 1, termId: term.id, active: true, memo: '' };
const input = () => ({ ownerId: 'owner', plans: [plan], monthEvents: [event], scheduleTemplates: [template], timetableTerms: [term] });
const occurrences = (data = input(), startDate = date, endDate = startDate) => createScheduleOccurrenceProjection({ ...data, startDate, endDate }).occurrences;

describe('single-day cancellation without source/history deletion', () => {
  it.each(['plan', 'month-event', 'timetable-template'] as const)('removes just one %s occurrence and preserves the next week', kind => {
    const data = input(), occurrence = occurrences(data).find(row => row.source.backingKind === kind)!;
    const change = buildDayOccurrenceCancellation({ ...data, occurrence });
    if (change.kind === 'plan') data.plans = [change.after];
    else if (change.kind === 'month-event') data.monthEvents = [change.after];
    else data.scheduleTemplates = change.after;
    expect(occurrences(data).some(row => row.id === occurrence.id)).toBe(false);
    expect(occurrences(data, '2026-10-12').filter(row => row.source.backingKind === kind)).toHaveLength(1);
    expect(change.before).toEqual(kind === 'plan' ? plan : kind === 'month-event' ? event : [template]);
  });
  it('cancels a grouped multi-period class through all of its backing templates', () => {
    const data = input(); data.scheduleTemplates.push({ ...template, id: 't2', periodNumber: 2, startTime: '15:00', endTime: '16:00' });
    const occurrence = occurrences(data).find(row => row.source.backingKind === 'timetable-template')!;
    expect(occurrence.source.backingId).not.toBe(template.id);
    const change = buildDayOccurrenceCancellation({ ...data, occurrence });
    if (change.kind !== 'timetable') throw Error('wrong kind');
    expect(change.after.map(row => row.excludedDates)).toEqual([[date], [date]]);
    expect(buildTimetableImportCandidates({ templates: change.after, date, weekday: 'mon', termId: term.id, term })).toEqual([]);
    expect(buildTimetableImportCandidates({ templates: change.after, date: '2026-10-12', weekday: 'mon', termId: term.id, term })).toHaveLength(1);
  });
  it('preserves imported and moved timetable identity and prevents the original template reappearing', () => {
    const data = input(); data.plans = [{ ...plan, date: '2026-10-06', repeat: 'none', sourceType: 'timetable', sourceId: 't', sourceDate: date }];
    const occurrence = occurrences(data, '2026-10-06')[0];
    const change = buildDayOccurrenceCancellation({ ...data, occurrence });
    if (change.kind !== 'plan') throw Error('wrong kind');
    expect(change.after).toMatchObject({ id: plan.id, sourceDate: date, sourceId: 't', excludedDates: ['2026-10-06'] });
    expect(occurrences({ ...data, plans: [change.after], monthEvents: [] }, date, '2026-10-06')).toEqual([]);
  });
  it('retains actual IDs, links and the same counted duration after canceling a Plan occurrence', () => {
    const data = input(), occurrence = occurrences(data).find(row => row.source.backingKind === 'plan')!;
    const change = buildDayOccurrenceCancellation({ ...data, occurrence });
    if (change.kind !== 'plan') throw Error('wrong kind');
    const actuals = [{ id: 'a', userId: 'owner', planId: plan.id, occurrenceDate: date, actualStartTime: '09:00', actualEndTime: '10:00', subject: 'Math', note: '', updatedAt: stamp }];
    const records = normalizeStudyRecordsForDisplay({ actuals, plans: [change.after] });
    expect(records).toHaveLength(1); expect(records[0].actual).toEqual(actuals[0]); expect(sumStudyRecordMinutes(records)).toBe(60);
  });
  it('rejects a stale or foreign occurrence before constructing writes', () => {
    const data = input(), occurrence = occurrences(data)[0];
    expect(() => buildDayOccurrenceCancellation({ ...data, occurrence: { ...occurrence, ownerId: 'other' } })).toThrow();
    expect(() => buildDayOccurrenceCancellation({ ...data, plans: [{ ...plan, title: 'Changed' }], occurrence })).toThrow();
  });
  it('keeps legacy templates compatible and normalizes malformed optional exclusions', () => {
    expect(normalizeScheduleTemplateRecord(template).excludedDates).toBeUndefined();
    const dirty = { ...template, excludedDates: [date, date, '2026-02-30', '', 7] } as unknown as ScheduleTemplate;
    expect(normalizeScheduleTemplateRecord(dirty).excludedDates).toEqual([date]);
  });
});
it('keeps explicit-date rule metadata for recorded history while excluding its only date', () => {
  const data = input();
  data.plans = [{ ...plan, repeat: 'none', recurrenceRules: [{ id: 'date-rule', kind: 'date', dates: [date], startDate: date,
    until: date, weekdays: [], dayType: null, isOverride: true, startTime: '18:00', endTime: '19:00', title: '特別なタイトル', subject: 'English', type: 'study', memo: '' }] }];
  const occurrence = occurrences(data).find(row => row.source.backingKind === 'plan')!;
  const change = buildDayOccurrenceCancellation({ ...data, occurrence });
  if (change.kind !== 'plan') throw Error('wrong kind');
  expect(change.after.recurrenceRules).toEqual(data.plans[0].recurrenceRules);
  expect(occurrences({ ...data, plans: [change.after] }).some(row => row.id === occurrence.id)).toBe(false);
});
