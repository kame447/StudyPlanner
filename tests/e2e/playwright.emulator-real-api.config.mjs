import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The real model through the real Worker (#926). The isolated emulator target (#947) keeps its auth and storage: the
// Firebase Auth and Firestore emulators, the repository's firestore.rules, the production Worker code on wrangler
// dev with the durable turn job on, and a production build with the durable client on. Only the model differs: the
// Worker's one allowed provider host is api.openai.com (emulator/worker/emulatorFetch.mjs). No production account,
// URL or Firebase credential is reachable; the only secret is OPENAI_API_KEY. Run by the owner-only
// weekly-planning-real-api-checkpoint workflow (profile vnext-worker), never by a pull request.
const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');
const VNEXT_STATE = path.join(repoRoot, 'artifacts/playwright-emulator-real-api-state.json');
const REAL_API = { STUDYPLANNER_E2E_REAL_API: '1' };

Object.assign(process.env, {
  ...REAL_API,
  STUDYPLANNER_LIVE_PASSWORD: 'emulator-only-password',
  STUDYPLANNER_LIVE_ACCESS_KEY: '',
  STUDYPLANNER_E2E_AUTH_EMULATOR_HOST: '127.0.0.1:9199',
  STUDYPLANNER_E2E_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180',
  STUDYPLANNER_E2E_EMULATOR_STATE: VNEXT_STATE,
});
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the real-API target.');

export default defineConfig({
  testDir: configDir,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json', { outputFile: path.join(repoRoot, 'artifacts/playwright-emulator-real-api-results.json') }]],
  outputDir: path.join(repoRoot, 'artifacts/playwright-emulator-real-api-results'),
  use: {
    baseURL: 'http://127.0.0.1:4176',
    timezoneId: 'Asia/Tokyo',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'emulator-real-api-setup',
      testMatch: 'emulator/account.setup.mjs',
      metadata: { email: 'e2e-real-api@example.test', statePath: VNEXT_STATE },
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-emulator-real-api',
      testMatch: 'emulator/vnext-real-api.emulator.mjs',
      dependencies: ['emulator-real-api-setup'],
      metadata: { email: 'e2e-real-api@example.test' },
      use: { ...devices['Desktop Chrome'], storageState: VNEXT_STATE },
    },
    // The examinee's last-week study record with the real model (#973 R1): a fresh conversation per scenario, browser clock fixed
    // at 2026-11-03 inside the spec. Same stack and the same one-run owner-only workflow; nothing above changes.
    {
      name: 'chromium-emulator-real-api-actual',
      testMatch: 'emulator/vnext-actual-record-real-api.emulator.mjs',
      dependencies: ['emulator-real-api-setup'],
      metadata: { email: 'e2e-real-api@example.test' },
      use: { ...devices['Desktop Chrome'], storageState: VNEXT_STATE },
    },
  ],
  webServer: [
    {
      command: 'node scripts/ci/firestore-tools.mjs emulators:start --only auth,firestore --project demo-studyplanner --config firebase.emulator-e2e.json',
      cwd: repoRoot,
      wait: { stdout: /All emulators ready/ },
      gracefulShutdown: { signal: 'SIGINT', timeout: 20_000 },
      timeout: 120_000,
    },
    {
      command: 'node tests/e2e/emulator/worker/start.mjs',
      cwd: repoRoot,
      env: REAL_API,
      wait: { stdout: /Ready on http:\/\/127\.0\.0\.1:18787/ },
      gracefulShutdown: { signal: 'SIGINT', timeout: 20_000 },
      timeout: 120_000,
    },
    {
      command: 'node ./node_modules/vite/bin/vite.js build --config tests/e2e/emulator/vite.config.mjs'
        + ' && node ./node_modules/vite/bin/vite.js preview --config tests/e2e/emulator/vite.config.mjs',
      cwd: repoRoot,
      env: REAL_API,
      url: 'http://127.0.0.1:4176',
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
