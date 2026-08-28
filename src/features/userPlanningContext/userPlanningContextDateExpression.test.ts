import { describe, expect, it } from 'vitest';
import {
  canonicalizeUserPlanningContextPartialDateV1,
  normalizeUserPlanningContextDateInputV1,
  parseUserPlanningContextDateRangeV1,
  resolveUserPlanningContextLifecycleDateV1,
  userPlanningContextDateEditorTextV1,
} from './userPlanningContextDateExpression';

describe('durable user planning context date expressions', () => {
  it('canonicalizes provider partial dates without inventing an exact event day', () => {
    expect(canonicalizeUserPlanningContextPartialDateV1('2027-01'))
      .toBe('2027-01-01/2027-01-31');
    expect(canonicalizeUserPlanningContextPartialDateV1('2027-02-late'))
      .toBe('2027-02-21/2027-02-28');
    expect(canonicalizeUserPlanningContextPartialDateV1('2027-02下旬'))
      .toBe('2027-02-21/2027-02-28');
    expect(canonicalizeUserPlanningContextPartialDateV1('year:2028;month:02;part:late'))
      .toBe('2028-02-21/2028-02-29');
  });

  it('accepts Japanese month-level settings input using the same canonical range', () => {
    expect(normalizeUserPlanningContextDateInputV1('2027年1月'))
      .toBe('2027-01-01/2027-01-31');
    expect(normalizeUserPlanningContextDateInputV1('2027年2月下旬'))
      .toBe('2027-02-21/2027-02-28');
  });

  it('round-trips exact ranges in settings without turning them into custom text', () => {
    const range = '2027-01-01/2027-01-31';
    expect(parseUserPlanningContextDateRangeV1(range)).toEqual({
      start: '2027-01-01',
      end: '2027-01-31',
    });
    expect(userPlanningContextDateEditorTextV1(range)).toBe(range);
    expect(normalizeUserPlanningContextDateInputV1(range)).toBe(range);
  });

  it('uses a range end only as lifecycle expiry while preserving the range expression', () => {
    expect(resolveUserPlanningContextLifecycleDateV1(
      '2027-01-01/2027-01-31',
      '2026-08-28',
    )).toBe('2027-01-31');
  });

  it('preserves existing supported relative/custom settings input', () => {
    expect(normalizeUserPlanningContextDateInputV1('2週間後')).toBe('custom:2週間後');
    expect(normalizeUserPlanningContextDateInputV1('custom:2週間後')).toBe('custom:2週間後');
    expect(userPlanningContextDateEditorTextV1('custom:2週間後')).toBe('2週間後');
  });

  it('does not canonicalize invalid partial dates', () => {
    expect(canonicalizeUserPlanningContextPartialDateV1('2027-13')).toBeNull();
    expect(parseUserPlanningContextDateRangeV1('2027-02-28/2027-02-21')).toBeNull();
  });
});
