import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, '../..');
export default defineConfig({
  testDir: dir, testMatch: 'weekly-real-scenarios.spec.mjs', fullyParallel: false, workers: 1,
  retries: 0, timeout: 60_000, reporter: 'list', outputDir: path.join(repoRoot, 'artifacts/weekly-real-scenarios'),
  use: { baseURL: 'http://127.0.0.1:4186', timezoneId: 'Asia/Tokyo', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  // Never reuse an unrelated checkout's server: assertions must cover this exact working tree.
  webServer: { command: 'node node_modules/vite/bin/vite.js --config tests/e2e/harness/weekly-real-scenarios.vite.config.mjs',
    cwd: repoRoot, url: 'http://127.0.0.1:4186/weekly-real-scenarios.html', reuseExistingServer: false, timeout: 30_000 },
});
