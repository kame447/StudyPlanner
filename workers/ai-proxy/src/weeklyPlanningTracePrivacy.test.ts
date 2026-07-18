import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_POLICY_VERSION,
  createWeeklyPlanningTraceSubject,
  isWeeklyPlanningTracePolicyAccepted,
  parseWeeklyPlanningTraceHmacSecrets,
  prepareWeeklyPlanningTraceWrite,
  redactWeeklyPlanningTraceValue,
  resolveWeeklyPlanningTraceEpoch,
  traceSubjectEpochsForDeletion,
  weeklyPlanningTraceExpireAt,
} from './weeklyPlanningTracePrivacy';

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

describe('weekly planning trace privacy boundary', () => {
  it('rotates the subject token by epoch without exposing the uid', async () => {
    const secrets = {
      '100': 'a'.repeat(32),
      '101': 'b'.repeat(32),
    };
    const first = await createWeeklyPlanningTraceSubject('firebase-user-123', '100', secrets);
    const same = await createWeeklyPlanningTraceSubject('firebase-user-123', '100', secrets);
    const rotated = await createWeeklyPlanningTraceSubject('firebase-user-123', '101', secrets);

    expect(first).toEqual(same);
    expect(first.token).toMatch(/^wpt_[A-Za-z0-9_-]+$/);
    expect(first.token).not.toContain('firebase-user-123');
    expect(rotated.token).not.toBe(first.token);
  });

  it('accepts only well-formed secret rings and lists every retained epoch', () => {
    const ring = parseWeeklyPlanningTraceHmacSecrets(JSON.stringify({
      '100': 'a'.repeat(32),
      '101': 'b'.repeat(48),
      invalid: 'c'.repeat(48),
    }));

    expect(traceSubjectEpochsForDeletion(ring)).toEqual(['100', '101']);
    expect(() => parseWeeklyPlanningTraceHmacSecrets('{bad')).toThrow(/invalid JSON/);
    expect(() => parseWeeklyPlanningTraceHmacSecrets(JSON.stringify({ '100': 'short' })))
      .toThrow(/no valid epoch secret/);
  });

  it('uses epochs no longer than thirty days and assigns a 180 day expiry', () => {
    const epochMs = 30 * 24 * 60 * 60 * 1000;
    const reference = new Date('2026-07-18T00:00:00.000Z');
    const epochStart = new Date(Math.floor(reference.getTime() / epochMs) * epochMs);
    const beforeRotation = new Date(epochStart.getTime() + 29 * 24 * 60 * 60 * 1000);
    const afterRotation = new Date(epochStart.getTime() + 30 * 24 * 60 * 60 * 1000);

    expect(resolveWeeklyPlanningTraceEpoch(epochStart))
      .toBe(resolveWeeklyPlanningTraceEpoch(beforeRotation));
    expect(resolveWeeklyPlanningTraceEpoch(epochStart))
      .not.toBe(resolveWeeklyPlanningTraceEpoch(afterRotation));
    expect(weeklyPlanningTraceExpireAt(reference)).toBe('2027-01-14T00:00:00.000Z');
  });

  it('removes identity keys and redacts common identifiers in nested content', () => {
    const redacted = redactWeeklyPlanningTraceValue({
      userId: 'raw-user',
      traceSubjectToken: 'wpt_internal-token',
      traceSubjectEpoch: '100',
      nested: {
        email: 'person@example.com',
        content: '連絡先は person@example.com / 090-1234-5678 https://example.com/path?token=secret',
        requestToken: 'abcdefghijklmnopqrstuvwxyz1234567890',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      },
    });
    const output = serialized(redacted);

    expect(output).not.toContain('raw-user');
    expect(output).not.toContain('wpt_internal-token');
    expect(output).not.toContain('traceSubjectEpoch');
    expect(output).not.toContain('person@example.com');
    expect(output).not.toContain('090-1234-5678');
    expect(output).not.toContain('token=secret');
    expect(output).not.toContain('123e4567-e89b-12d3-a456-426614174000');
    expect(output).toContain('[EMAIL]');
    expect(output).toContain('[PHONE]');
    expect(output).toContain('[QUERY_REDACTED]');
  });

  it('prepares session and entry documents without raw account identifiers', async () => {
    const subject = await createWeeklyPlanningTraceSubject(
      'firebase-user-123',
      '100',
      { '100': 'a'.repeat(32) },
    );
    const prepared = prepareWeeklyPlanningTraceWrite({
      session: {
        id: 'session-1',
        userId: 'firebase-user-123',
        logicalConversationId: 'conversation-1',
        status: 'active',
      },
      entries: [{
        id: 'entry-1',
        sessionId: 'session-1',
        userId: 'firebase-user-123',
        kind: 'turn',
        content: 'person@example.com',
      }],
    }, subject, '2026-07-18T00:00:00.000Z');
    const output = serialized(prepared);

    expect(output).not.toContain('firebase-user-123');
    expect(output).not.toContain('person@example.com');
    expect(prepared.session.traceSubjectToken).toBe(subject.token);
    expect(prepared.entries[0].traceSubjectEpoch).toBe('100');
    expect(prepared.entries[0].policyVersion).toBe(WEEKLY_PLANNING_TRACE_POLICY_VERSION);
    expect(prepared.entries[0].expireAt).toBe('2027-01-14T00:00:00.000Z');
  });

  it('requires matching entry ownership and the current policy version', () => {
    expect(() => prepareWeeklyPlanningTraceWrite({
      session: { id: 'session-1' },
      entries: [{ id: 'entry-1', sessionId: 'session-2' }],
    }, { token: 'wpt_token', epoch: '100' })).toThrow(/session mismatch/);

    expect(isWeeklyPlanningTracePolicyAccepted({
      version: WEEKLY_PLANNING_TRACE_POLICY_VERSION,
      acceptedAt: '2026-07-18T00:00:00.000Z',
    })).toBe(true);
    expect(isWeeklyPlanningTracePolicyAccepted({
      version: 'old',
      acceptedAt: '2026-07-18T00:00:00.000Z',
    })).toBe(false);
  });
});
