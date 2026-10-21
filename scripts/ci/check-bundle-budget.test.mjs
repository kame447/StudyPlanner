import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const command = fileURLToPath(new URL('./check-bundle-budget.mjs', import.meta.url));
const temporaryRoots = [];
afterEach(() => { for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function check({ css = 8_000, font = 512_000, includeFont = true, javascript = [], extraCss = [] } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'appearance-budget-')); temporaryRoots.push(root);
  mkdirSync(path.join(root, 'dist/assets'), { recursive: true }); mkdirSync(path.join(root, 'dist/fonts'));
  writeFileSync(path.join(root, 'dist/assets/appearance-pixel-test.css'), ' '.repeat(css));
  for (const [index, size] of javascript.entries()) writeFileSync(path.join(root, `dist/assets/chunk-${index}.js`), ' '.repeat(size));
  for (const [index, size] of extraCss.entries()) writeFileSync(path.join(root, `dist/assets/style-${index}.css`), ' '.repeat(size));
  if (includeFont) writeFileSync(path.join(root, 'dist/fonts/DotGothic16-Regular.woff2'), Buffer.alloc(font));
  const result = spawnSync(process.execPath, [command], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  return { ...result, report: includeFont ? JSON.parse(readFileSync(path.join(root, 'artifacts/quality-gate/bundle-budget.json'), 'utf8')) : null };
}

describe('production bundle and optional appearance guards', () => {
  it('pins the exact owner-approved guarded rejection fallback increment without changing CSS/appearance guards', () => {
    const result = check(); expect(result.status).toBe(0); expect(result.report.violations).toEqual([]);
    expect(result.report.budgets.javascript).toEqual({ totalRaw: 2_616_972, totalGzip: 711_893, largestRaw: 1_050_074, largestGzip: 289_210 });
    expect(result.report.budgets.css).toEqual({ totalRaw: 513_954, totalGzip: 89_911, largestRaw: 425_000, largestGzip: 70_000 });
  });
  it.each([
    { kind: 'javascript', metric: 'totalRaw', options: { javascript: [1_000_000, 1_000_000, 616_972] } },
    { kind: 'javascript', metric: 'largestRaw', options: { javascript: [1_050_074] } },
    { kind: 'css', metric: 'totalRaw', options: { extraCss: [250_000, 255_954] } },
    { kind: 'css', metric: 'largestRaw', options: { extraCss: [425_000] } },
  ])('blocks one byte over the exact $kind $metric boundary', ({ kind, metric, options }) => {
    const exact = check(options);
    expect(exact.status).toBe(0); expect(exact.report.violations).toEqual([]);
    const values = options.javascript ?? options.extraCss;
    const increased = [...values]; increased[increased.length - 1]++;
    const over = check(options.javascript ? { javascript: increased } : { extraCss: increased });
    expect(over.status).toBe(1);
    expect(over.report.violations).toEqual([{ kind, metric,
      actual: exact.report.budgets[kind][metric] + 1, limit: exact.report.budgets[kind][metric] }]);
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
