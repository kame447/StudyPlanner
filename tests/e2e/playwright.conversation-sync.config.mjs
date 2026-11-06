import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'conversation-sync-storage.spec.mjs',
  fullyParallel: false, workers: 1, retries: 0,
  outputDir: '../../artifacts/issue47-browser-results',
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
});
