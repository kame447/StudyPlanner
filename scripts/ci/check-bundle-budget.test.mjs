import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const command = fileURLToPath(new URL('./check-bundle-budget.mjs', import.meta.url));
const temporaryRoots = [];
afterEach(() => { for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function check({ css = 8_000, font = 512_000, includeFont = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'appearance-budget-')); temporaryRoots.push(root);
  mkdirSync(path.join(root, 'dist/assets'), { recursive: true }); mkdirSync(path.join(root, 'dist/fonts'));
  writeFileSync(path.join(root, 'dist/assets/appearance-pixel-test.css'), ' '.repeat(css));
  if (includeFont) writeFileSync(path.join(root, 'dist/fonts/DotGothic16-Regular.woff2'), Buffer.alloc(font));
  const result = spawnSync(process.execPath, [command], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  return { ...result, report: includeFont ? JSON.parse(readFileSync(path.join(root, 'artifacts/quality-gate/bundle-budget.json'), 'utf8')) : null };
}

describe('optional appearance bundle guards', () => {
  it('accepts exact new-asset boundaries and preserves every other limit', () => {
    const result = check(); expect(result.status).toBe(0); expect(result.report.violations).toEqual([]);
    expect(result.report.budgets.javascript).toEqual({ totalRaw: 2_260_000, totalGzip: 608_500, largestRaw: 950_000, largestGzip: 260_000 });
    expect(result.report.budgets.css).toEqual({ totalRaw: 493_000, totalGzip: 85_000, largestRaw: 425_000, largestGzip: 70_000 });
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
