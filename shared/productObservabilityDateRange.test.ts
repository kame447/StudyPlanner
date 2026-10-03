import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatObservabilityReportingDate, listObservabilityDatesInclusive, shiftObservabilityDate } from './productObservabilityDateRange';

describe('listObservabilityDatesInclusive', () => {
  it('includes a single day once', () => {
    expect(listObservabilityDatesInclusive('2026-09-01', '2026-09-01', 93))
      .toEqual(['2026-09-01']);
  });

  it('includes both endpoints across a month boundary', () => {
    expect(listObservabilityDatesInclusive('2026-01-30', '2026-02-02', 93)).toEqual([
      '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02',
    ]);
  });

  it('includes leap day in a leap year', () => {
    expect(listObservabilityDatesInclusive('2024-02-28', '2024-03-01', 93)).toEqual([
      '2024-02-28', '2024-02-29', '2024-03-01',
    ]);
  });

  it('skips leap day in a non-leap year', () => {
    expect(listObservabilityDatesInclusive('2026-02-28', '2026-03-01', 93))
      .toEqual(['2026-02-28', '2026-03-01']);
  });

  it('crosses a year boundary', () => {
    expect(listObservabilityDatesInclusive('2026-12-31', '2027-01-01', 93))
      .toEqual(['2026-12-31', '2027-01-01']);
  });

  it('enumerates UTC days through a daylight-saving transition', () => {
    expect(listObservabilityDatesInclusive('2026-03-07', '2026-03-10', 93)).toEqual([
      '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
    ]);
  });

  it('accepts the existing 93-day service bound', () => {
    const dates = listObservabilityDatesInclusive('2026-01-01', '2026-04-03', 93);
    expect(dates).toHaveLength(93);
    expect(new Set(dates).size).toBe(93);
    expect(dates[0]).toBe('2026-01-01');
    expect(dates[92]).toBe('2026-04-03');
  });

  it('rejects the first day beyond the bound', () => {
    expect(() => listObservabilityDatesInclusive('2026-01-01', '2026-04-04', 93))
      .toThrow('observability_date_range_too_large');
  });

  it('uses the caller-supplied bound', () => {
    expect(listObservabilityDatesInclusive('2026-01-01', '2026-01-02', 2))
      .toEqual(['2026-01-01', '2026-01-02']);
    expect(() => listObservabilityDatesInclusive('2026-01-01', '2026-01-03', 2))
      .toThrow('observability_date_range_too_large');
  });

  it.each([
    ['', ''],
    ['', '2026-01-01'],
    ['2026-01-01', ''],
    ['2026-01-02', '2026-01-01'],
    ['not-a-date', '2026-01-01'],
    ['2026-01-01', 'not-a-date'],
    ['2026-1-01', '2026-01-02'],
    [' 2026-01-01', '2026-01-02'],
    ['2026-01-01', '2026-01-02T00:00:00Z'],
    ['2026-13-01', '2026-13-01'],
    ['2026-00-01', '2026-01-01'],
    ['2026-01-32', '2026-02-01'],
  ])('rejects invalid range %s through %s', (fromDate, toDate) => {
    expect(() => listObservabilityDatesInclusive(fromDate, toDate, 93))
      .toThrow('observability_date_range_invalid');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid bound %s', (maxDays) => {
    expect(() => listObservabilityDatesInclusive('2026-01-01', '2026-01-01', maxDays))
      .toThrow('observability_date_range_invalid');
  });

  it('preserves existing normalization of overflowing calendar days', () => {
    expect(listObservabilityDatesInclusive('2026-02-30', '2026-02-30', 93))
      .toEqual(['2026-03-02']);
  });

  it('preserves an empty interval when a normalized start is after the end', () => {
    expect(listObservabilityDatesInclusive('2026-02-31', '2026-03-01', 93)).toEqual([]);
  });
});


describe('observability reporting calendar', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'])('uses the reporting timezone under host TZ=%s', (hostTimezone) => {
    vi.stubEnv('TZ', hostTimezone);
    expect(formatObservabilityReportingDate(new Date('2026-10-03T14:59:59.999Z'))).toBe('2026-10-03');
    expect(formatObservabilityReportingDate(new Date('2026-10-03T15:00:00.000Z'))).toBe('2026-10-04');
    expect(formatObservabilityReportingDate(new Date('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01');
    expect(shiftObservabilityDate('2026-03-08', 1)).toBe('2026-03-09');
    expect(shiftObservabilityDate('2026-11-01', -1)).toBe('2026-10-31');
  });

  it.each([
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2026-10-03', -6, '2026-09-27'],
    ['2026-10-03', -29, '2026-09-04'],
    ['2026-10-03', 0, '2026-10-03'],
    // Preserve the existing arithmetic behavior; validation belongs to callers.
    ['2026-02-30', 1, '2026-03-03'],
  ])('shifts %s by %s calendar days to %s', (date, offset, expected) => {
    expect(shiftObservabilityDate(date, offset)).toBe(expected);
  });

  it('retains native invalid-date failures for unchecked callers', () => {
    expect(() => shiftObservabilityDate('invalid', 1)).toThrow(RangeError);
    expect(() => formatObservabilityReportingDate(new Date('invalid'))).toThrow(RangeError);
  });
});
