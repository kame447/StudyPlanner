import { describe, expect, it } from 'vitest';
import { actual, event, plan } from '../repositories/localPersistenceConcurrency.testUtils';
import { prepareActualProgressSource } from './actualProgressSource';

const source = { kind: 'general-event' as const, sourceId: 'event' };
describe('confirmed Actual progress provenance', () => {
  it.each([
    [plan(), 'study'], [plan({ type: 'other' }), 'general-event'],
    [plan({ type: 'study', sourceType: 'timetable' }), 'timetable'],
  ] as const)('derives the kind from the same-owner source (%s)', (savedPlan, kind) => {
    const result = prepareActualProgressSource(actual({ progressSource: source }), { plans: [savedPlan], monthEvents: [] });
    expect(result.progressSource).toEqual({ kind, sourceId: savedPlan.id, planType: savedPlan.type });
  });
  it('captures a month-event, preserves unlinking, and replaces it on explicit relink', () => {
    const sources = { plans: [plan()], monthEvents: [event()] };
    const saved = prepareActualProgressSource(actual({ planId: 'event' }), sources);
    expect(saved.progressSource).toEqual(source);
    const detached = prepareActualProgressSource({ ...saved, planId: null, occurrenceDate: '2026-10-06' }, sources, saved);
    expect(detached.progressSource).toEqual(source);
    expect(prepareActualProgressSource({ ...detached, planId: 'plan' }, sources, detached).progressSource)
      .toEqual({ kind: 'study', sourceId: 'plan', planType: 'study' });
  });
  it('backfills legacy unlinking only while its original same-owner source is known', () => {
    const old = actual({ planId: 'event' });
    expect(prepareActualProgressSource({ ...old, planId: null }, { plans: [], monthEvents: [event()] }, old).progressSource).toEqual(source);
    expect(prepareActualProgressSource({ ...old, planId: null }, { plans: [], monthEvents: [] }, old).progressSource).toBeUndefined();
  });
  it('does not trust a supplied source, foreign source, foreign previous record, or title', () => {
    const forged = actual({ planId: 'event', title: '塾バイト', progressSource: source });
    expect(prepareActualProgressSource(forged, { plans: [], monthEvents: [event({ userId: 'other' })] }).progressSource).toBeUndefined();
    expect(prepareActualProgressSource(forged, { plans: [], monthEvents: [] }, { ...forged, userId: 'other' }).progressSource).toBeUndefined();
    expect(prepareActualProgressSource({ ...forged, planId: null }, { plans: [], monthEvents: [] }).progressSource).toBeUndefined();
  });
});

import { buildHomeDashboardModel } from '../lib/homeDashboard';
import { collectStudyDates } from '../lib/studyStreak';
import { normalizeStudyRecordsForDisplay } from '../lib/studyRecords';

it('preserves an occurrence-specific type through unlinking', () => {
  const date = '2026-10-15';
  const source = plan({ date, type: 'study', recurrenceRules: [{ id: 'override', kind: 'date', startDate: date,
    until: null, dates: [date], weekdays: [], dayType: null, isOverride: true, type: 'school-event', startTime: '09:00', endTime: '10:00' }] });
  const saved = prepareActualProgressSource(actual({ occurrenceDate: date }), { plans: [source], monthEvents: [] });
  const detached = prepareActualProgressSource({ ...saved, planId: null }, { plans: [source], monthEvents: [] }, saved);
  expect(detached.progressSource).toMatchObject({ kind: 'general-event', planType: 'school-event' });
  for (const row of [saved, detached]) expect(buildHomeDashboardModel({ plans: [source], actuals: [row], monthEvents: [], todos: [],
    now: new Date(date + 'T22:00:00') }).weekActualMinutes).toBe(0);
});

it.each(['mock-exam', 'cram-school'] as const)('keeps existing report/streak membership after unlinking %s', type => {
  const date = '2026-10-15', source = plan({ date, type });
  const saved = prepareActualProgressSource(actual({ occurrenceDate: date }), { plans: [source], monthEvents: [] });
  const detached = prepareActualProgressSource({ ...saved, planId: null }, { plans: [source], monthEvents: [] }, saved);
  for (const row of [saved, detached]) expect(collectStudyDates({ userId: 'owner', plans: [source], monthEvents: [], actuals: [row], today: date })).toEqual([date]);
});

it('prefers the live same-owner source, including colliding foreign IDs', () => {
  const original = actual({ progressSource: { kind: 'general-event', sourceId: 'old-event' } });
  const own = plan(), foreign = plan({ userId: 'other', type: 'other' });
  const records = normalizeStudyRecordsForDisplay({ actuals: [original], plans: [own, foreign] });
  expect(records[0].plan?.userId).toBe('owner'); expect(records[0].type).toBe('study');
});

it.each(['unknown', 'study', 'general-event', 'timetable'] as const)('uses saved %s membership after link loss for every settings combination', kind => {
  const date = '2026-10-15';
  const row = actual({ planId: null, occurrenceDate: date,
    ...(kind === 'unknown' ? {} : { progressSource: { kind, sourceId: 'removed-source' } }) });
  for (const includeGeneralEvents of [false, true]) for (const includeTimetable of [false, true]) {
    const expected = kind === 'general-event' ? includeGeneralEvents : kind === 'timetable' ? includeTimetable : true;
    const dashboard = buildHomeDashboardModel({ plans: [], actuals: [row], monthEvents: [], todos: [], now: new Date(date + 'T22:00:00'),
      progressPreferences: { includeGeneralEvents, includeTimetable } });
    expect(dashboard.weekActualMinutes).toBe(expected ? 60 : 0);
  }
});
