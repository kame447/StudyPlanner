import { describe, expect, it } from 'vitest';
import {
  normalizeAiQuotaRuleLimit,
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
