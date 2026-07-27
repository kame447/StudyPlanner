import { describe, expect, it } from 'vitest';
import {
  containsForbiddenWeeklyPlanningTraceKey,
  sanitizeWeeklyPlanningTraceValue,
} from './weeklyPlanningTraceRedaction';

describe('sanitizeWeeklyPlanningTraceValue', () => {
  it('禁止キーを大小文字と区切りの差に関係なく除去する', () => {
    const result = sanitizeWeeklyPlanningTraceValue({
      safe: 'kept',
      apiKey: 'secret-value',
      nested: {
        Authorization: 'Bearer secret',
        raw_prompt: 'private prompt',
        allowedTokenCount: 10,
      },
    });

    expect(result.value).toEqual({
      safe: 'kept',
      nested: {
        allowedTokenCount: 10,
      },
    });
    expect(containsForbiddenWeeklyPlanningTraceKey(result.value)).toBe(false);
  });

  it('巨大payloadを有限な縮約値へ置き換える', () => {
    const result = sanitizeWeeklyPlanningTraceValue(
      { content: 'a'.repeat(1_000) },
      { maxStringLength: 1_000, maxSerializedBytes: 100 },
    );

    expect(result.truncated).toBe(true);
    expect(result.serializedBytes).toBeLessThanOrEqual(100);
    expect(result.value).toEqual(expect.objectContaining({
      __truncated__: '[TRUNCATED]',
    }));
  });

  it('同じobjectの共有参照を循環参照として失わない', () => {
    const shared = { revision: 3, tasks: [{ id: 'task-1' }] };
    const result = sanitizeWeeklyPlanningTraceValue({
      inputGraph: shared,
      decisionGraph: shared,
    });

    expect(result.value).toEqual({
      inputGraph: { revision: 3, tasks: [{ id: 'task-1' }] },
      decisionGraph: { revision: 3, tasks: [{ id: 'task-1' }] },
    });
    expect(result.truncated).toBe(false);
  });

  it('objectの循環参照を保存可能な値へ変換する', () => {
    const value: Record<string, unknown> = { name: 'root' };
    value.self = value;

    const result = sanitizeWeeklyPlanningTraceValue(value);

    expect(result.value).toEqual({ name: 'root', self: '[CIRCULAR]' });
    expect(result.truncated).toBe(true);
  });

  it('arrayの循環参照を保存可能な値へ変換する', () => {
    const value: unknown[] = ['root'];
    value.push(value);

    const result = sanitizeWeeklyPlanningTraceValue(value);

    expect(result.value).toEqual(['root', '[CIRCULAR]']);
    expect(result.truncated).toBe(true);
  });
});
