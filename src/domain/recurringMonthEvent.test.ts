import { describe, expect, it } from 'vitest';
import { buildRecurringMonthEventEdit, createMonthEventOccurrenceDraft } from './recurringMonthEvent';
import { doesMonthEventOccurOnDate } from '../lib/monthEvents';
import type { MonthEvent } from '../types/domain';

const source: MonthEvent = { id: 'event', userId: 'owner', date: '2026-10-04', endDate: '2026-10-04', title: 'Original',
  startTime: '09:00', endTime: '10:00', repeat: 'weekly', repeatUntil: '2026-12-31', excludedDates: ['2026-11-01'],
  url: 'https://example.com', memo: 'memo', locationTags: ['school'], checklist: [{ id: 'item', text: 'book', checked: true }],
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', busy: false };
const titles = (rows: MonthEvent[], date: string) => rows.filter(event => doesMonthEventOccurOnDate(event, date)).map(event => event.title);
describe('recurring general event edits', () => {
  it.each(['single', 'future'] as const)('retains prior dates and exclusions for %s', scope => {
    const snapshot = structuredClone(source);
    const draft = { ...createMonthEventOccurrenceDraft(source, '2026-10-11'), title: 'Changed', startTime: '11:00', endTime: '12:00' };
    const result = buildRecurringMonthEventEdit(source, draft, '2026-10-11', scope);
    expect(titles(result.monthEvents, '2026-10-04')).toEqual(['Original']);
    expect(titles(result.monthEvents, '2026-10-11')).toEqual(['Changed']);
    expect(titles(result.monthEvents, '2026-10-18')).toEqual([scope === 'single' ? 'Original' : 'Changed']);
    expect(titles(result.monthEvents, '2026-11-01')).toEqual([]);
    expect(result.editedEvent).toMatchObject({ busy: false, checklist: source.checklist, locationTags: source.locationTags, url: source.url });
    expect(source).toEqual(snapshot);
  });
  it('updates the first future occurrence in place without creating an empty old series', () => {
    const draft = { ...createMonthEventOccurrenceDraft(source, source.date), title: 'Changed' };
    const result = buildRecurringMonthEventEdit(source, draft, source.date, 'future');
    expect(result.monthEvents).toHaveLength(1); expect(result.editedEvent.id).toBe(source.id);
  });
  it.each(['single', 'future'] as const)('uses a multi-day occurrence start rather than its clicked continuation day for %s', scope => {
    const event = { ...source, endDate: '2026-10-06', startTime: '22:00', endTime: '02:00' };
    const draft = createMonthEventOccurrenceDraft(event, '2026-10-12');
    expect(draft).toMatchObject({ date: '2026-10-11', endDate: '2026-10-13' });
    const result = buildRecurringMonthEventEdit(event, { ...draft, title: 'Changed' }, '2026-10-12', scope);
    expect(titles(result.monthEvents, '2026-10-04')).toEqual(['Original']);
    expect(titles(result.monthEvents, '2026-10-11')).toEqual(['Changed']);
    expect(titles(result.monthEvents, '2026-10-13')).toEqual(['Changed']);
    expect(titles(result.monthEvents, '2026-10-18')).toEqual([scope === 'single' ? 'Original' : 'Changed']);
  });
  it.each([
    { repeat: 'daily' as const, date: '2026-10-04', next: '2026-10-06', later: '2026-10-07' },
    { repeat: 'monthly' as const, date: '2026-01-31', next: '2026-03-31', later: '2026-05-31' },
    { repeat: 'yearly' as const, date: '2024-02-29', next: '2028-02-29', later: '2032-02-29' },
  ])('retains $repeat cadence and original past', ({ repeat, date, next, later }) => {
    const event = { ...source, repeat, date, endDate: date, repeatUntil: null, excludedDates: [] };
    const result = buildRecurringMonthEventEdit(event, { ...createMonthEventOccurrenceDraft(event, next), title: 'Changed' }, next, 'future');
    expect(titles(result.monthEvents, date)).toEqual(['Original']);
    expect(titles(result.monthEvents, next)).toEqual(['Changed']);
    expect(titles(result.monthEvents, later)).toEqual(['Changed']);
  });
  it('a moved single occurrence changes just that occurrence and does not leave a duplicate', () => {
    const draft = { ...createMonthEventOccurrenceDraft(source, '2026-10-11'), date: '2026-10-12', endDate: '2026-10-12', title: 'Moved' };
    const result = buildRecurringMonthEventEdit(source, draft, '2026-10-11', 'single');
    expect(titles(result.monthEvents, '2026-10-11')).toEqual([]);
    expect(titles(result.monthEvents, '2026-10-12')).toEqual(['Moved']);
    expect(titles(result.monthEvents, '2026-10-18')).toEqual(['Original']);
  });
  it('retains the old series while stopping repetition from the chosen occurrence', () => {
    const draft = { ...createMonthEventOccurrenceDraft(source, '2026-10-11'), repeat: 'none' as const };
    const result = buildRecurringMonthEventEdit(source, draft, '2026-10-11', 'future');
    expect(titles(result.monthEvents, '2026-10-04')).toEqual(['Original']);
    expect(titles(result.monthEvents, '2026-10-11')).toEqual(['Original']);
    expect(titles(result.monthEvents, '2026-10-18')).toEqual([]);
  });
  it.each(['2026-10-03', '2027-01-03'])('rejects a future move to %s rather than adding past recurrences or removing the expiry', date => {
    const draft = { ...createMonthEventOccurrenceDraft(source, '2026-10-11'), date, endDate: date, repeatUntil: null };
    expect(() => buildRecurringMonthEventEdit(source, draft, '2026-10-11', 'future')).toThrow();
    const single = buildRecurringMonthEventEdit(source, draft, '2026-10-11', 'single');
    expect(single.editedEvent).toMatchObject({ date, repeat: 'none', repeatUntil: null });
  });
  it('retains the inherited expiry and exclusions even when normalization drops hidden draft metadata', () => {
    const draft = { ...createMonthEventOccurrenceDraft(source, '2026-10-11'), repeatUntil: null, excludedDates: [] };
    const result = buildRecurringMonthEventEdit(source, draft, '2026-10-11', 'future');
    expect(result.editedEvent.repeatUntil).toBe(source.repeatUntil);
    expect(titles(result.monthEvents, '2026-11-01')).toEqual([]);
    expect(titles(result.monthEvents, '2027-01-03')).toEqual([]);
  });
  it.each(['foreign', 'excluded', 'missing', 'invalid range'] as const)('rejects %s before returning a mutation', reason => {
    const date = reason === 'excluded' ? '2026-11-01' : reason === 'missing' ? '2026-10-12' : '2026-10-11';
    const draft = { ...createMonthEventOccurrenceDraft(source, date), ...(reason === 'foreign' ? { userId: 'other' } : {}),
      ...(reason === 'invalid range' ? { endDate: '2026-01-01' } : {}) };
    expect(() => buildRecurringMonthEventEdit(source, draft, date, 'future')).toThrow();
  });
});
