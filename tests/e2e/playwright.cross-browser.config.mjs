import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config.mjs';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');
const artifactsDir = path.join(repoRoot, 'artifacts');
const isCi = Boolean(process.env.CI);
const sharedTests = ['**/timetable-class-attendance.spec.mjs', '**/compact-record-forms.spec.mjs', '**/auth-entry-presentation.spec.mjs', '**/auth-interaction.spec.mjs', '**/startup-initial-canvas.spec.mjs', '**/cross-browser-smoke.spec.mjs', '**/home-next-plan-visual.spec.mjs', '**/home-scene-atmosphere.spec.mjs', '**/app-settings-page.spec.mjs', '**/public-page-navigation.spec.mjs', '**/theme-storage-failure.spec.mjs', '**/primary-header-responsive.spec.mjs'];

export default defineConfig({
  ...baseConfig,
  testMatch: sharedTests,
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
      testMatch: [...sharedTests, '**/bookshelf-material-name-order.spec.mjs'],
      use: {
        ...devices['Desktop Safari'],
        browserName: 'webkit',
        viewport: { width: 1280, height: 720 },
        screen: { width: 1280, height: 720 },
      },
    },
    {
      name: 'webkit-mobile',
      testMatch: [...sharedTests, '**/day-timetable-details.spec.mjs', '**/schedule-event-colors.spec.mjs', '**/actual-editor-date-validation.spec.mjs', '**/month-event-range.spec.mjs', '**/day-timetable-occurrence-controls.spec.mjs', '**/study-streak-calendar.spec.mjs', '**/day-timetable-visibility.spec.mjs', '**/bookshelf-material-name-order.spec.mjs', '**/appearance-theme.spec.mjs', '**/appearance-startup.spec.mjs', '**/ai-planning-composer-viewport.spec.mjs', '**/weekly-keyboard.spec.mjs', '**/home-layout-responsive.spec.mjs', '**/home-pixel-student.spec.mjs', '**/study-session-unplanned.spec.mjs', '**/study-session-touch-swipe.spec.mjs', '**/laplance-startup-video.spec.mjs', '**/profile-restore-recovery.spec.mjs', '**/home-content-responsive.spec.mjs', '**/preferences-read-recovery.spec.mjs', '**/startup-diagnostics.spec.mjs', '**/home-add-touch.spec.mjs', '**/home-add-mobile-motion.spec.mjs', '**/weekly-durable-return.spec.mjs'],
      use: {
        ...devices['iPhone 13'],
        browserName: 'webkit',
      },
    },
  ],
});
