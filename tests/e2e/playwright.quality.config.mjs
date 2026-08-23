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
  testMatch: ['**/quality-gates.spec.mjs'],
  testIgnore: [],
  outputDir: path.join(artifactsDir, 'playwright-quality-results'),
  reporter: isCi
    ? [
        ['list'],
        ['json', { outputFile: path.join(artifactsDir, 'playwright-quality-results.json') }],
        ['html', { outputFolder: path.join(artifactsDir, 'playwright-quality-report'), open: 'never' }],
      ]
    : 'list',
  use: {
    ...baseConfig.use,
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    screen: { width: 1280, height: 720 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium-quality',
    },
  ],
});
