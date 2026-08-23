import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const rawBaseUrl = process.env.STUDYPLANNER_LIVE_BASE_URL?.trim();

if (!rawBaseUrl) {
  throw new Error('STUDYPLANNER_LIVE_BASE_URL is required for live-account verification.');
}

let baseUrl;
try {
  baseUrl = new URL(rawBaseUrl);
} catch {
  throw new Error('STUDYPLANNER_LIVE_BASE_URL must be a valid URL.');
}

const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (baseUrl.protocol !== 'https:' || localHosts.has(baseUrl.hostname)) {
  throw new Error(
    'Live-account verification requires a non-local HTTPS production URL.',
  );
}

export default defineConfig({
  testDir: configDir,
  testMatch: '**/*.live.mjs',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 10_000,
  },
  reporter: 'list',
  use: {
    baseURL: baseUrl.toString().replace(/\/$/, ''),
    timezoneId: 'Asia/Tokyo',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium-live-account',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
