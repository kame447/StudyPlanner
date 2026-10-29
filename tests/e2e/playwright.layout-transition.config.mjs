import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'artifacts/layout-frame-diagnostic');
export default defineConfig({
  ...base,
  testMatch: '**/layout-transition-frames.spec.mjs', testIgnore: [],
  timeout: 90_000, retries: 0, workers: 1, fullyParallel: false,
  outputDir: path.join(output, 'results'),
  reporter: [['list'], ['json', { outputFile: path.join(output, 'results.json') }]],
  use: { ...base.use, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', trace: 'on', video: 'on', screenshot: 'only-on-failure' },
  projects: [
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: [base.webServer[0]],
});
