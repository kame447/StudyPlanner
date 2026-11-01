import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { stableV5HarnessServer, stableV5Specs } from './support/stable-v5-specs.mjs';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');
const artifactsDir = path.join(repoRoot, 'artifacts');
const isCi = Boolean(process.env.CI);
// Chunk-load recovery is product behavior of whichever core lazy-loads its runtime: the default
// VNext build loads weeklyPlanningVNextRuntimeModule, the comparison build the V5 executor. The spec
// runs against both; every other stable-v5 spec stays comparison-only.
const sharedCoreSpecs = new Set(['**/weekly-planning-module-recovery.spec.mjs']);
const stableV5OnlySpecs = stableV5Specs.filter(spec => !sharedCoreSpecs.has(spec));

export default defineConfig({
  testDir: configDir,
  testIgnore: [
    '**/admin-overview-render.spec.mjs',
    '**/admin-mobile-navigation.spec.mjs',
    '**/admin-system-environment.spec.mjs',
    '**/admin-analysis-query-snapshot.spec.mjs',
    '**/support-inquiries.spec.mjs',
    '**/announcements.spec.mjs',
    '**/cross-browser-smoke.spec.mjs',
    '**/home-add-mobile-motion.spec.mjs',
    '**/quality-gates.spec.mjs',
    '**/visual-regression.spec.mjs',
  ],
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  failOnFlakyTests: isCi,
  workers: isCi ? 1 : undefined,
  reporter: isCi
    ? [
        ['list'],
        ['json', { outputFile: path.join(artifactsDir, 'playwright-results.json') }],
        ['html', { outputFolder: path.join(artifactsDir, 'playwright-report'), open: 'never' }],
      ]
    : 'list',
  outputDir: path.join(artifactsDir, 'playwright-results'),
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: stableV5OnlySpecs,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-stable-v5',
      testMatch: stableV5Specs,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4178' },
    },
  ],
  webServer: [
    stableV5HarnessServer(repoRoot),
    {
      // Keep the comparison build separate from the production dist directory.
      command: 'VITE_WEEKLY_PLANNING_CORE=stable_v5 npm run build -- --outDir artifacts/e2e-stable-v5-build'
        + ' && npm run preview:vite -- --outDir artifacts/e2e-stable-v5-build --port 4178 --host 127.0.0.1',
      cwd: repoRoot,
      url: 'http://127.0.0.1:4178',
      reuseExistingServer: !isCi,
      timeout: 300_000,
    },
    {
      command: 'npm run preview:vite -- --port 4173',
      cwd: repoRoot,
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
    {
      command: 'node ./node_modules/vite/bin/vite.js --config tests/e2e/harness/vite.config.mjs',
      cwd: repoRoot,
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
    {
      command: 'node ./node_modules/vite/bin/vite.js --config tests/e2e/harness/durable.vite.config.mjs',
      cwd: repoRoot,
      url: 'http://127.0.0.1:4175/real-weekly.html',
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
  ],
});
