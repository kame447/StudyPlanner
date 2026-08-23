import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config.mjs';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');
const artifactsDir = path.join(repoRoot, 'artifacts');
const isCi = Boolean(process.env.CI);

const desktop = {
  ...devices['Desktop Chrome'],
  browserName: 'chromium',
  viewport: { width: 1440, height: 900 },
  screen: { width: 1440, height: 900 },
};

const mobile = {
  ...devices['Pixel 5'],
  browserName: 'chromium',
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
};

export default defineConfig({
  ...baseConfig,
  testMatch: ['**/visual-regression.spec.mjs'],
  testIgnore: [],
  outputDir: path.join(artifactsDir, 'playwright-visual-results'),
  reporter: isCi
    ? [
        ['list'],
        ['json', { outputFile: path.join(artifactsDir, 'playwright-visual-results.json') }],
        ['html', { outputFolder: path.join(artifactsDir, 'playwright-visual-report'), open: 'never' }],
      ]
    : 'list',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.2,
      maxDiffPixelRatio: 0.003,
    },
  },
  use: {
    ...baseConfig.use,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'desktop-light',
      metadata: { theme: 'light' },
      use: { ...desktop, colorScheme: 'light' },
    },
    {
      name: 'desktop-dark',
      metadata: { theme: 'dark' },
      use: { ...desktop, colorScheme: 'dark' },
    },
    {
      name: 'mobile-light',
      metadata: { theme: 'light' },
      use: { ...mobile, colorScheme: 'light' },
    },
    {
      name: 'mobile-dark',
      metadata: { theme: 'dark' },
      use: { ...mobile, colorScheme: 'dark' },
    },
  ],
});
