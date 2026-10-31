import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Runs the existing live-account, test-account seed and weekly-planning trace live specs against the real
// application on a local server, backed by the Firebase Auth and Firestore emulators with the repository's
// firestore.rules and the production Worker code on wrangler dev (#947). The accounts are created on the
// emulator; no production URL, account or secret is used. Values set here replace any live credentials
// that happen to be in the environment.
const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');
const isCi = Boolean(process.env.CI);
const traceSessionFile = path.join(repoRoot, 'artifacts/playwright-emulator-trace-session.txt');

Object.assign(process.env, {
  STUDYPLANNER_LIVE_EMAIL: 'e2e-account@example.test',
  STUDYPLANNER_LIVE_PASSWORD: 'emulator-only-password',
  STUDYPLANNER_LIVE_ACCESS_KEY: '',
  STUDYPLANNER_TRACE_E2E_EMAIL: 'e2e-trace-account@example.test',
  STUDYPLANNER_TRACE_E2E_PASSWORD: 'emulator-only-trace-password',
  // The trace specs fall back to the production Worker when this is empty; always the local Worker here.
  STUDYPLANNER_LIVE_TRACE_API_URL: 'http://127.0.0.1:18787',
  STUDYPLANNER_E2E_AUTH_EMULATOR_HOST: '127.0.0.1:9199',
  STUDYPLANNER_E2E_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180',
  // The returning accounts' device-local first-run tour completion, saved by the setup project.
  STUDYPLANNER_E2E_EMULATOR_STATE: path.join(repoRoot, 'artifacts/playwright-emulator-state.json'),
  STUDYPLANNER_E2E_TRACE_SESSION_FILE: traceSessionFile,
  // Each project runs in a new worker that loads this file again, so the admin spec's project reads the
  // session the privacy spec wrote; the setup project removes any earlier run's file first.
  STUDYPLANNER_TRACE_ADMIN_SESSION_ID: existsSync(traceSessionFile) ? readFileSync(traceSessionFile, 'utf8').trim() : '',
});

export default defineConfig({
  testDir: configDir,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: path.join(repoRoot, 'artifacts/playwright-emulator-results.json') }]],
  outputDir: path.join(repoRoot, 'artifacts/playwright-emulator-results'),
  use: {
    baseURL: 'http://127.0.0.1:4176',
    timezoneId: 'Asia/Tokyo',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'emulator-account-setup', testMatch: 'emulator/account.setup.mjs', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium-emulator-account',
      testMatch: ['live-account-schedule.live.mjs', 'test-account-seed.seed.mjs'],
      dependencies: ['emulator-account-setup'],
      // The seed spec registers several fixtures through the UI; same budget as its own config.
      timeout: 10 * 60_000,
      use: { ...devices['Desktop Chrome'], storageState: process.env.STUDYPLANNER_E2E_EMULATOR_STATE },
    },
    {
      name: 'chromium-emulator-trace',
      testMatch: 'weekly-planning-trace-privacy.live.mjs',
      dependencies: ['emulator-account-setup'],
      use: { ...devices['Desktop Chrome'], storageState: process.env.STUDYPLANNER_E2E_EMULATOR_STATE },
    },
    {
      name: 'emulator-trace-session',
      testMatch: 'emulator/trace-session.setup.mjs',
      dependencies: ['chromium-emulator-trace'],
    },
    {
      name: 'chromium-emulator-trace-admin',
      testMatch: 'weekly-planning-trace-admin-ui.live.mjs',
      dependencies: ['emulator-trace-session'],
      use: { ...devices['Desktop Chrome'], storageState: process.env.STUDYPLANNER_E2E_EMULATOR_STATE },
    },
  ],
  webServer: [
    {
      command: 'node scripts/ci/firestore-tools.mjs emulators:start --only auth,firestore --project demo-studyplanner --config firebase.emulator-e2e.json',
      cwd: repoRoot,
      // One emulator accepting connections does not mean the other has started; only the CLI's
      // ready line covers both, so this entry has no url (a url alone would end the wait early).
      wait: { stdout: /All emulators ready/ },
      // SIGINT lets the CLI stop its Java emulator; a plain kill leaves it running.
      gracefulShutdown: { signal: 'SIGINT', timeout: 20_000 },
      timeout: 120_000,
    },
    {
      // Synthetic AI provider: answers only what a test scripts (tests/e2e/emulator/syntheticProvider.mjs).
      command: 'node tests/e2e/emulator/syntheticProvider.mjs',
      cwd: repoRoot,
      url: 'http://127.0.0.1:18790/__synthetic/health',
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
    {
      // The production Worker on wrangler dev, redirected to the emulators and the synthetic provider.
      command: 'node tests/e2e/emulator/worker/start.mjs',
      cwd: repoRoot,
      wait: { stdout: /Ready on http:\/\/127\.0\.0\.1:18787/ },
      gracefulShutdown: { signal: 'SIGINT', timeout: 20_000 },
      timeout: 120_000,
    },
    {
      command: 'node ./node_modules/vite/bin/vite.js build --config tests/e2e/emulator/vite.config.mjs'
        + ' && node ./node_modules/vite/bin/vite.js preview --config tests/e2e/emulator/vite.config.mjs',
      cwd: repoRoot,
      url: 'http://127.0.0.1:4176',
      reuseExistingServer: !isCi,
      timeout: 300_000,
    },
  ],
});
