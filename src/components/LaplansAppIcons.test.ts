import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const icons = [
  { rel: 'icon', size: 32, sha256: 'fc5f619e30d20fa41e47c8a320245540c2e266aad3bbe6e894f3cf5171d33174' },
  { rel: 'icon', size: 192, sha256: '54789a76641d7c741b2b317e63c1c21d014010397c53d601fcf9f708d9e3da3e' },
  { rel: 'apple-touch-icon', size: 180, sha256: '780d048c816789c7218468ab04678f2ba29a70828208e2ce2a74b0745cbe2e04' },
];

describe('Laplance application icons', () => {
  it.each(icons)('declares and ships the supplied symbol for $rel at $size pixels', ({ rel, size, sha256 }) => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const href = `/icons/laplans-${size}.png`;
    const links = html.match(/<link\b[^>]*>/g) ?? [];
    expect(links).toContain(
      `<link rel="${rel}" type="image/png" sizes="${size}x${size}" href="${href}" />`,
    );
    const png = readFileSync(new URL(`../../public${href}`, import.meta.url));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
    expect(createHash('sha256').update(png).digest('hex')).toBe(sha256);
  });
});
