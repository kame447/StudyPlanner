import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const raw = process.env.STUDYPLANNER_LIVE_BASE_URL?.trim();
if (!raw) throw new Error('STUDYPLANNER_LIVE_BASE_URL is required.');
const base = new URL(raw);
if (base.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(base.hostname)) {
  throw new Error('D5 production smoke requires a non-local HTTPS URL.');
}
if (process.env.D5_PRODUCTION_SMOKE !== '1') throw new Error('Explicit D5_PRODUCTION_SMOKE=1 is required.');
if (![process.env.EXPECT_JEV ?? '0', process.env.EXPECT_FALLBACK ?? '0'].every(flag => ['0', '1'].includes(flag))) throw new Error('EXPECT_JEV and EXPECT_FALLBACK must be 0 or 1.');
if (process.env.EXPECT_JEV === '1' && process.env.EXPECT_FALLBACK === '1') throw new Error('EXPECT_JEV and EXPECT_FALLBACK are mutually exclusive.');

export default defineConfig({
  testDir: path.dirname(fileURLToPath(import.meta.url)),
  testMatch: 'd5-production-readonly.smoke.mjs',
  fullyParallel: false, workers: 1, retries: 0,
  // Runner budgets only. The real production client's 5 s candidate timeout is unchanged.
  timeout: 180_000, expect: { timeout: 30_000 }, reporter: 'list',
  outputDir: '../../artifacts/d5-production-smoke',
  use: { baseURL: base.toString().replace(/\/$/, ''), timezoneId: 'Asia/Tokyo',
    trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium-d5-production-readonly', use: { ...devices['Desktop Chrome'] } }],
});
