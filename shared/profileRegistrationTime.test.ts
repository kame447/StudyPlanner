import { describe, expect, it } from 'vitest';
import { normalizeProfileRegistrationTimestamp } from './profileRegistrationTime';

describe('normalizeProfileRegistrationTimestamp', () => {
  it('normalizes ISO and Firebase-style GMT strings to UTC ISO', () => {
    expect(normalizeProfileRegistrationTimestamp('2026-08-28T12:34:56.000Z'))
      .toBe('2026-08-28T12:34:56.000Z');
    expect(normalizeProfileRegistrationTimestamp('Fri, 28 Aug 2026 12:34:56 GMT'))
      .toBe('2026-08-28T12:34:56.000Z');
  });

  it('returns null for blank or invalid values instead of inventing a timestamp', () => {
    expect(normalizeProfileRegistrationTimestamp('')).toBeNull();
    expect(normalizeProfileRegistrationTimestamp('not-a-date')).toBeNull();
    expect(normalizeProfileRegistrationTimestamp(null)).toBeNull();
  });
});
