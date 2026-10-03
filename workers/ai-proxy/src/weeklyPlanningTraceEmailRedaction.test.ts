import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { redactWeeklyPlanningTraceEmails } from './weeklyPlanningTraceEmailRedaction';
import { redactWeeklyPlanningTraceValue } from './weeklyPlanningTracePrivacy';

const legacyPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

describe('bounded trace email redaction search', () => {
  it.each([
    'person@example.com',
    'before A+B@A-B.co after',
    'a@b.co.c@d.ef',
    'a@@b.co',
    'prefix foo@bar.com?!bar@example.net',
    '日本語foo@bar.exampleと日本語',
    'x@' + '.'.repeat(2000) + 'x',
    'x'.repeat(4000) + '@a.bc',
  ])('preserves existing masking for %s', (value) => {
    expect(redactWeeklyPlanningTraceEmails(value)).toBe(value.replace(legacyPattern, '[EMAIL]'));
  });

  it('matches the prior masking contract on deterministic mixed-text cases', () => {
    const atoms = ['x', 'a', 'b', 'c', '@', '.', '-', '_', '+', '%', ' ', '/', '\n', '!',
      '日本語', '123', 'https://', 'xx.yy', 'foo@bar.com', 'A+B@A-B.co', 'a@b.co.c@d.ef'];
    fc.assert(fc.property(fc.array(fc.constantFrom(...atoms), { maxLength: 40 }), (parts) => {
      const value = parts.join('');
      expect(redactWeeklyPlanningTraceEmails(value)).toBe(value.replace(legacyPattern, '[EMAIL]'));
    }), { seed: 92837, numRuns: 3000 });
  });

  it('handles long unsuccessful local parts without changing text', () => {
    for (const value of ['x'.repeat(64_000), '.'.repeat(64_000), 'x'.repeat(64_000) + '@', 'x@' + '.'.repeat(64_000) + 'x']) {
      expect(redactWeeklyPlanningTraceEmails(value)).toBe(value);
    }
  });

  it('redacts before truncating so the stored-display boundary cannot expose an email prefix', () => {
    const value = ' '.repeat(3990) + 'person@example.com';
    expect(redactWeeklyPlanningTraceValue(value)).toBe(' '.repeat(3990) + '[EMAIL]');
    expect(JSON.stringify(redactWeeklyPlanningTraceValue({ detail: value }))).not.toContain('person@');
  });

  it('keeps the other identity and token redaction stages active', () => {
    const value = redactWeeklyPlanningTraceValue({
      email: 'person@example.com',
      message: 'person@example.com 090-1234-5678 123e4567-e89b-42d3-a456-426614174000 abcdefghijklmnopqrstuvwxyz123456',
    });
    expect(JSON.stringify(value)).not.toContain('person@example.com');
    expect(JSON.stringify(value)).not.toContain('090-1234-5678');
    expect(JSON.stringify(value)).not.toContain('123e4567');
    expect(JSON.stringify(value)).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
  });
});
