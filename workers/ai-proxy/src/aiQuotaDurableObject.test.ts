import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeAiQuotaRuleLimit,
  AiQuotaDurableObject,
  TELEMETRY_ADMISSION_LIMITS,
  buildTelemetryQuotaRules,
  type AiQuotaWindowRule,
} from './aiQuotaDurableObject';

function rule(name: string, limit: number): AiQuotaWindowRule {
  return {
    name,
    limit,
    windowId: 'window',
    resetAt: Date.now() + 60_000,
  };
}

describe('AI quota floors', () => {
  it.each([
    ['ip:minute', 20, 120],
    ['chat:uid:minute', 5, 30],
    ['chat:uid:day', 100, 1000],
    ['ocr:uid:minute', 2, 10],
    ['ocr:uid:day', 5, 100],
    ['attachment:uid:minute', 3, 10],
    ['attachment:uid:day', 20, 100],
  ])('raises %s from %i to %i', (name, configured, expected) => {
    expect(normalizeAiQuotaRuleLimit(rule(name, configured))).toBe(expected);
  });

  it('never lowers a larger configured limit', () => {
    expect(normalizeAiQuotaRuleLimit(rule('chat:uid:minute', 60))).toBe(60);
    expect(normalizeAiQuotaRuleLimit(rule('custom:uid:minute', 250))).toBe(250);
  });
});

afterEach(() => vi.useRealTimers());

function quotaObject(initial?: Record<string, unknown>) {
  let state: unknown = initial;
  const storage = { get: async () => structuredClone(state), put: async (_key: string, value: unknown) => { state = structuredClone(value); } };
  return new AiQuotaDurableObject({ storage } as never, {});
}

describe('telemetry quota buckets', () => {
  it('admits exactly the minute budget, preserves AI quotas, and resets the next minute', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-10-17T00:00:00.000Z');
    vi.setSystemTime(now);
    const quota = quotaObject();
    for (let index = 0; index < TELEMETRY_ADMISSION_LIMITS.minute; index += 1) {
      expect((await quota.checkAndConsume({ rules: buildTelemetryQuotaRules() })).allowed).toBe(true);
    }
    expect(await quota.checkAndConsume({ rules: buildTelemetryQuotaRules() })).toMatchObject({ allowed: false,
      exceededRule: 'telemetry:uid:minute', retryAfterSeconds: 60 });
    const secondUser = quotaObject();
    expect((await secondUser.checkAndConsume({ rules: buildTelemetryQuotaRules() })).allowed).toBe(true);
    expect((await quota.checkAndConsume({ rules: [rule('chat:uid:minute', 30)] })).allowed).toBe(true);
    vi.setSystemTime(now + 60_000);
    expect((await quota.checkAndConsume({ rules: buildTelemetryQuotaRules() })).allowed).toBe(true);
  });

  it('enforces the daily budget across minute windows and resets at Japan midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T14:59:00.000Z'));
    const dayRule = buildTelemetryQuotaRules()[1];
    const quota = quotaObject({ [dayRule.name]: { windowId: dayRule.windowId, resetAt: dayRule.resetAt,
      count: TELEMETRY_ADMISSION_LIMITS.day - 1 } });
    expect((await quota.checkAndConsume({ rules: buildTelemetryQuotaRules() })).allowed).toBe(true);
    expect(await quota.checkAndConsume({ rules: buildTelemetryQuotaRules() })).toMatchObject({ allowed: false,
      exceededRule: 'telemetry:uid:day', retryAfterSeconds: 60 });
    vi.setSystemTime(new Date('2026-10-17T15:00:00.000Z'));
    expect((await quota.checkAndConsume({ rules: buildTelemetryQuotaRules() })).allowed).toBe(true);
  });
});
