import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const command = fileURLToPath(new URL('./check-bundle-budget.mjs', import.meta.url));
const temporaryRoots = [];
afterEach(() => { for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function check({ css = 8_000, font = 512_000, includeFont = true, javascript = [], extraCss = [] } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'appearance-budget-')); temporaryRoots.push(root);
  mkdirSync(path.join(root, 'dist/assets'), { recursive: true }); mkdirSync(path.join(root, 'dist/fonts'));
  writeFileSync(path.join(root, 'dist/assets/appearance-pixel-test.css'), ' '.repeat(css));
  for (const [index, size] of javascript.entries()) writeFileSync(path.join(root, `dist/assets/chunk-${index}.js`), typeof size === 'number' ? ' '.repeat(size) : size);
  for (const [index, size] of extraCss.entries()) writeFileSync(path.join(root, `dist/assets/style-${index}.css`), typeof size === 'number' ? ' '.repeat(size) : size);
  if (includeFont) writeFileSync(path.join(root, 'dist/fonts/DotGothic16-Regular.woff2'), Buffer.alloc(font));
  const result = spawnSync(process.execPath, [command], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  return { ...result, report: includeFont ? JSON.parse(readFileSync(path.join(root, 'artifacts/quality-gate/bundle-budget.json'), 'utf8')) : null };
}

describe('production bundle and optional appearance guards', () => {
  it('preserves the reviewed references including the measured #842 CSS calibration', () => {
    const result = check(); expect(result.status).toBe(0); expect(result.report.violations).toEqual([]);
    expect(result.report.baselines.javascript).toEqual({ totalRaw: 2_617_120, totalGzip: 711_893, largestRaw: 1_050_074, largestGzip: 289_210 });
    expect(result.report.baselines.css).toEqual({ totalRaw: 513_993, totalGzip: 89_918, largestRaw: 425_000, largestGzip: 70_000 });
  });
  it('allows small growth without ratcheting the reference and reports explicit allowances', () => {
    const result = check({ extraCss: [250_000, 256_032] });
    expect(result.status).toBe(0);
    expect(result.report.growth).toContainEqual(expect.objectContaining({ kind: 'css', metric: 'totalRaw', baseline: 513_993, actual: 514_032, delta: 39 }));
    expect(result.report.growthPolicy).toEqual({ relative: 0.05, rawFloor: 16_384, gzipFloor: 4_096 });
    expect(result.report.budgets).toEqual({
      javascript: { totalRaw: 2_747_976, totalGzip: 747_487, largestRaw: 1_102_577, largestGzip: 303_670 },
      css: { totalRaw: 539_692, totalGzip: 94_413, largestRaw: 446_250, largestGzip: 74_096 },
      appearance: { stylesheetRaw: 8_000, fontRaw: 512_000 },
    });
  });
  it.each([
    { kind: 'javascript', metric: 'totalRaw', options: { javascript: [1_000_000, 1_000_000, 747_976] } },
    { kind: 'javascript', metric: 'largestRaw', options: { javascript: [1_102_577] } },
    { kind: 'css', metric: 'totalRaw', options: { extraCss: [250_000, 281_692] } },
    { kind: 'css', metric: 'largestRaw', options: { extraCss: [446_250] } },
  ])('blocks one byte over the excessive-growth $kind $metric boundary', ({ kind, metric, options }) => {
    const exact = check(options);
    expect(exact.status).toBe(0); expect(exact.report.violations).toEqual([]);
    const values = options.javascript ?? options.extraCss;
    const increased = [...values]; increased[increased.length - 1]++;
    const over = check(options.javascript ? { javascript: increased } : { extraCss: increased });
    expect(over.status).toBe(1);
    expect(over.report.violations).toEqual([{ kind, metric,
      actual: exact.report.budgets[kind][metric] + 1, limit: exact.report.budgets[kind][metric] }]);
  });
  it.each([
    { kind: 'javascript', metric: 'totalGzip', sizes: [260_000, 260_000, 260_000] },
    { kind: 'javascript', metric: 'largestGzip', sizes: [310_000] },
    { kind: 'css', metric: 'totalGzip', sizes: [50_000, 50_000] },
    { kind: 'css', metric: 'largestGzip', sizes: [76_000] },
  ])('rejects excessive $kind $metric even when raw sizes pass', ({ kind, metric, sizes }) => {
    const assets = sizes.map(size => Buffer.concat(Array.from({ length: Math.ceil(size / 32) },
      (_, index) => createHash('sha256').update(String(index)).digest())).subarray(0, size));
    const result = check(kind === 'javascript' ? { javascript: assets } : { extraCss: assets });
    expect(result.status).toBe(1);
    expect(result.report.violations.map(v => `${v.kind}.${v.metric}`)).toEqual([`${kind}.${metric}`]);
    expect(result.report[kind].files.some(file => file.gzip === gzipSync(assets[0], { level: 9 }).byteLength)).toBe(true);
  });
  it.each([{ css: 8_001, metric: 'stylesheetRaw' }, { font: 512_001, metric: 'fontRaw' }])('rejects an over-budget $metric', ({ metric, ...sizes }) => {
    const result = check(sizes); expect(result.status).toBe(1);
    expect(result.report.violations).toEqual([expect.objectContaining({ kind: 'appearance', metric })]);
  });
  it('rejects a missing font instead of silently reporting zero cost', () => {
    const result = check({ includeFont: false }); expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Expected one optional dot stylesheet and its self-hosted WOFF2 font.');
  });
});
