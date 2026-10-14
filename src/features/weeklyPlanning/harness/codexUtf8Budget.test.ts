// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 OpenAI
// Golden cases ported from codex-rs/utils/string/src/truncate/tests.rs at
// 1f7fe9b0afb301f895b2d56ae8c05c2cfb19e440; additional JS/JSON cases by Laplance.
import { describe, expect, it } from 'vitest';
import { approximateTokenCount, truncateMiddleWithMarker, utf8ByteLength, utf8Prefix, utf8Suffix } from './codexUtf8Budget';
import { boundContextJson } from './codexJsonPreview';

describe('Codex UTF-8 budget port', () => {
  it.each([
    ['head' + 'x'.repeat(100) + 'tail', 32, '<truncated>', 'headxxxxxx<truncated>xxxxxxxtail'],
    ['head🦀🦀🦀🦀🦀tail', 18, '...', 'head...🦀tail'],
    ['short', 5, '...', 'short'],
    ['🦀abc', 4, 'marker', '🦀'],
  ] as const)('preserves the upstream golden case %s', (text, budget, marker, expected) => {
    expect(truncateMiddleWithMarker(text, budget, marker)).toBe(expected);
  });

  it('preserves scalar boundaries and the hard byte limit including marker overhead', () => {
    const samples = ['研究する。ただし保存しない。', 'é中😀é', '👩‍💻a🦀\n末尾', '\ufeffhead🦀tail', '', 'a'.repeat(99)];
    for (const sample of samples) for (let limit = 0; limit < 100; limit += 1) {
      const bounded = truncateMiddleWithMarker(sample, limit, '…[truncated]');
      expect(utf8ByteLength(bounded)).toBeLessThanOrEqual(limit);
      expect(bounded).not.toContain('\ufffd');
      if (utf8ByteLength(sample) <= limit) expect(bounded).toBe(sample);
      expect(utf8ByteLength(utf8Prefix(sample, limit))).toBeLessThanOrEqual(limit);
      expect(utf8ByteLength(utf8Suffix(sample, limit))).toBeLessThanOrEqual(limit);
    }
    expect(utf8Prefix('\ufeffabc', 3)).toBe('\ufeff');
    expect(utf8Suffix('abc\ufeff', 3)).toBe('\ufeff');
  });

  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid JS byte budget %s', limit => {
    expect(() => truncateMiddleWithMarker('data', limit, '...')).toThrow(RangeError);
  });

  it('uses the upstream approximate byte estimator, not JavaScript character length', () => {
    expect(approximateTokenCount('')).toBe(0);
    expect(approximateTokenCount('abcde')).toBe(2);
    expect(approximateTokenCount('研究')).toBe(2);
    expect(approximateTokenCount('😀')).toBe(1);
  });

  it('budgets serialized escaping in previews without changing small structured data', () => {
    const small = { ok: false, futureField: 'retained' };
    expect(boundContextJson(small, 128)).toEqual(small);
    for (const budget of [128, 256, 1024, 12288]) {
      const large = { head: 'start', text: ('"\\\n😀\u0000').repeat(9000), tail: 'finish' };
      const result = boundContextJson(large, budget);
      expect(result).toMatchObject({ traceTruncated: true, originalBytes: expect.any(Number) });
      expect(utf8ByteLength(JSON.stringify(result))).toBeLessThanOrEqual(budget);
      expect(JSON.stringify(result)).not.toContain('\ufffd');
      if (budget >= 256) expect(JSON.stringify(result)).toContain('finish');
    }
    const cycle: { value?: unknown } = {};
    cycle.value = cycle;
    expect(boundContextJson(cycle, 256)).toEqual({ traceTruncated: true, reason: 'unserializable' });
  });
});
