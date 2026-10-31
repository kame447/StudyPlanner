import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Runs the existing live-account spec unchanged against the real application on a local server,
// backed by the Firebase Auth and Firestore emulators with the repository's firestore.rules (#947).
// The account is created on the emulator; no production URL, account or secret is used. Values set
// here replace any live credentials that happen to be in the environment.
const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');
const isCi = Boolean(process.env.CI);

Object.assign(process.env, {
  STUDYPLANNER_LIVE_EMAIL: 'e2e-account@example.test',
  STUDYPLANNER_LIVE_PASSWORD: 'emulator-only-password',
  STUDYPLANNER_LIVE_ACCESS_KEY: '',
  STUDYPLANNER_E2E_AUTH_EMULATOR_HOST: '127.0.0.1:9199',
  // The returning account's device-local first-run tour completion, saved by the setup project.
  STUDYPLANNER_E2E_EMULATOR_STATE: path.join(repoRoot, 'artifacts/playwright-emulator-state.json'),
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
      // test-account-seed.seed.mjs fails here while adding its second material; it has never run
      // anywhere, and its triage is a separate #947 item, so it is not counted as covered.
      testMatch: 'live-account-schedule.live.mjs',
      dependencies: ['emulator-account-setup'],
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
      command: 'node ./node_modules/vite/bin/vite.js build --config tests/e2e/emulator/vite.config.mjs'
        + ' && node ./node_modules/vite/bin/vite.js preview --config tests/e2e/emulator/vite.config.mjs',
      cwd: repoRoot,
      url: 'http://127.0.0.1:4176',
      reuseExistingServer: !isCi,
      timeout: 300_000,
    },
  ],
});
