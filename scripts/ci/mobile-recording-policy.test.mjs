import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const base = read('tests/e2e/playwright.config.mjs');
const crossBrowser = read('tests/e2e/playwright.cross-browser.config.mjs');
const matrix = read('.github/workflows/ui-regression.yml');
const bookshelf = read('tests/e2e/bookshelf-surface.spec.mjs');
const longText = bookshelf.slice(bookshelf.indexOf('test.describe(`material long text'));
const mobile = crossBrowser.slice(crossBrowser.indexOf("name: 'webkit-mobile'"));

describe('bounded mobile retry recording', () => {
  it('opts in only the bookshelf file at the runner-supported top level', () => {
    const policy = "if (process.env.CI && process.env.UI_RETRY_CAPTURE === '1') {\n  test.use({ trace: 'on-first-retry', video: 'on-first-retry' });\n}";
    expect(bookshelf).toContain(policy);
    expect(bookshelf.indexOf(policy)).toBeLessThan(bookshelf.indexOf('test.afterEach('));
    expect(bookshelf.match(/on-first-retry/g)).toHaveLength(2);
    expect(longText).toContain("test.use({ viewport, screen: viewport, contextOptions: { reducedMotion: 'reduce' } });");
    expect(longText).not.toContain('UI_RETRY_CAPTURE');
    expect(mobile).toContain("...devices['iPhone 13']");
    expect(mobile).not.toMatch(/deviceScaleFactor:|viewport:|screen:|timeout:|retries:|workers:/);
    expect(bookshelf).not.toMatch(/configure\(|retries:/);
    // The separately approved functional budget is test-local, never a capture-policy override.
    expect(bookshelf.match(/setTimeout/g)).toHaveLength(1);
    expect(bookshelf).toContain('testInfo.setTimeout(60_000);');
    expect(longText).not.toContain('deviceScaleFactor:');
    expect(bookshelf).toContain('deviceScaleFactor: 3');
  });

  it('keeps local, unopted-in and other-project capture plus failure screenshots', () => {
    expect(base).toContain("trace: 'retain-on-failure'");
    expect(base).toContain("video: 'retain-on-failure'");
    expect(base).toContain("screenshot: 'only-on-failure'");
    expect(base).not.toContain('UI_RETRY_CAPTURE');
    expect(crossBrowser).toContain('...baseConfig.use');
  });

  it('retains one CI retry and rejects flaky passes with the original worker budget', () => {
    expect(base).toContain('retries: isCi ? 1 : 0');
    expect(base).toContain('failOnFlakyTests: isCi');
    expect(base).toContain('workers: isCi ? 1 : undefined');
    expect(base).toContain('fullyParallel: false');
    expect(crossBrowser).toContain('...baseConfig,');
    expect(crossBrowser).not.toMatch(/\b(?:timeout|retries|failOnFlakyTests|workers)\s*:/);
    // No global timeout override: the default stays 30s outside three approved journeys.
    expect(base.split('webServer:')[0]).not.toMatch(/\btimeout\s*:/);
  });

  it('opts in the matrix execution step while preserving zero-retry stability capture', () => {
    expect(matrix).toContain("UI_PROJECT: ${{ matrix.project }}\n          UI_RETRY_CAPTURE: ${{ matrix.project == 'webkit-mobile' && '1' || '0' }}");
    expect(matrix.match(/UI_RETRY_CAPTURE/g)).toHaveLength(1);
    expect(matrix).toContain('node scripts/ci/playwright-shard.mjs "${args[@]}"');
    expect(matrix).not.toMatch(/--(?:retries|timeout|workers)=/);
    const stability = read('.github/workflows/ui-quality-automation.yml');
    expect(stability).toContain('--repeat-each=3 --retries=0');
    expect(stability).not.toContain('UI_RETRY_CAPTURE');
    expect(read('tests/e2e/playwright.planner-recovery.config.mjs')).toContain('retries: 0');
  });
});
