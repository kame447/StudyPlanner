import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config.mjs';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');
const artifactsDir = path.join(repoRoot, 'artifacts');
const isCi = Boolean(process.env.CI);

export default defineConfig({
  ...baseConfig,
  testMatch: ['**/cross-browser-smoke.spec.mjs'],
  testIgnore: [],
  outputDir: path.join(artifactsDir, 'playwright-cross-browser-results'),
  reporter: isCi
    ? [
        ['list'],
        ['json', { outputFile: path.join(artifactsDir, 'playwright-cross-browser-results.json') }],
        ['html', { outputFolder: path.join(artifactsDir, 'playwright-cross-browser-report'), open: 'never' }],
      ]
    : 'list',
  use: {
    ...baseConfig.use,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
        screen: { width: 1280, height: 720 },
      },
    },
    {
      name: 'firefox-desktop',
      use: {
        ...devices['Desktop Firefox'],
        browserName: 'firefox',
        viewport: { width: 1280, height: 720 },
        screen: { width: 1280, height: 720 },
      },
    },
    {
      name: 'webkit-desktop',
      use: {
        ...devices['Desktop Safari'],
        browserName: 'webkit',
        viewport: { width: 1280, height: 720 },
        screen: { width: 1280, height: 720 },
      },
    },
    {
      name: 'webkit-mobile',
      use: {
        ...devices['iPhone 13'],
        browserName: 'webkit',
      },
    },
  ],
});
