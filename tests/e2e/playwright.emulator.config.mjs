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

const VNEXT_STATE = path.join(repoRoot, 'artifacts/playwright-emulator-vnext-state.json');
const ACTUAL_WEEK_STATE = path.join(repoRoot, 'artifacts/playwright-emulator-actual-week-state.json');

// The durable-turn target (#926): the production durable job on, the model still the synthetic provider. It is
// a second Worker and a second production build beside the default pair, on their own ports, so every project
// above keeps its target unchanged. The VNext production smoke runs here, with its own account.
const DURABLE = {
  STUDYPLANNER_E2E_DURABLE: '1',
  STUDYPLANNER_E2E_WORKER_PORT: '18788',
  STUDYPLANNER_E2E_APP_PORT: '4180',
  STUDYPLANNER_E2E_INSPECTOR_PORT: '9330',
};
const DURABLE_APP = `http://127.0.0.1:${DURABLE.STUDYPLANNER_E2E_APP_PORT}`;
const DURABLE_STATE = path.join(repoRoot, 'artifacts/playwright-emulator-vnext-production-state.json');
const ACTUAL_CHAT_STATE = path.join(repoRoot, 'artifacts/playwright-emulator-actual-chat-state.json');

// Each independent durable scenario keeps its own UID quota; the production limits remain active.
const durableScenarioAccounts = [
  { key: 'p3-effort', testMatch: 'emulator/vnext-durable-no-options-repeat.emulator.mjs', grep: /effort_inconsistent/ },
  { key: 'p3-completed', testMatch: 'emulator/vnext-durable-no-options-repeat.emulator.mjs', grep: /completed_exceeds_total/ },
  { key: 'p3-remaining', testMatch: 'emulator/vnext-durable-option-conflict-repeat.emulator.mjs', grep: /remaining_inconsistent/ },
  { key: 'p3-work-identity', testMatch: 'emulator/vnext-durable-option-conflict-repeat.emulator.mjs', grep: /same_or_distinct_work/ },
  { key: 'provider-failure', testMatch: 'emulator/vnext-durable-provider-failure.emulator.mjs' },
  { key: 'pending-actuals', testMatch: 'emulator/vnext-durable-provider-failure-pending-actuals.emulator.mjs' },
  { key: 'repeated-question', testMatch: 'emulator/vnext-durable-repeated-question.emulator.mjs' },
  { key: 'worker-terminal', testMatch: 'emulator/vnext-durable-worker-terminal.emulator.mjs' },
  { key: 'worker-unreachable', testMatch: 'emulator/vnext-durable-worker-unreachable.emulator.mjs' },
];

const actualChatScenarioAccounts = [
  { key: 'dialogue', testMatch: ['emulator/vnext-actual-chat-save-intent.emulator.mjs', 'emulator/vnext-actual-correction.emulator.mjs', 'emulator/vnext-actual-mixed-utterance.emulator.mjs', 'emulator/vnext-actual-provisional-confirm.emulator.mjs'] },
  { key: 'plan-question', testMatch: 'emulator/vnext-actual-pending-with-plan-question.emulator.mjs' },
];

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
    // The VNext experiment (#926), switched on by its explicit local query parameter, with its own account.
    {
      name: 'emulator-vnext-setup',
      testMatch: 'emulator/account.setup.mjs',
      metadata: { email: 'e2e-vnext@example.test', statePath: VNEXT_STATE },
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-emulator-vnext',
      testMatch: 'emulator/vnext-conversation.emulator.mjs',
      dependencies: ['emulator-vnext-setup'],
      metadata: { email: 'e2e-vnext@example.test' },
      use: { ...devices['Desktop Chrome'], storageState: VNEXT_STATE },
    },
    // The examinee's week of study records through the existing record UI (no model, no Worker call), own account.
    {
      name: 'emulator-actual-week-setup',
      testMatch: 'emulator/account.setup.mjs',
      metadata: { email: 'e2e-actual-week@example.test', statePath: ACTUAL_WEEK_STATE },
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-emulator-actual-week',
      testMatch: 'emulator/actual-week.emulator.mjs',
      dependencies: ['emulator-actual-week-setup'],
      metadata: { email: 'e2e-actual-week@example.test' },
      use: { ...devices['Desktop Chrome'], storageState: ACTUAL_WEEK_STATE },
    },
    {
      name: 'emulator-vnext-production-setup',
      testMatch: 'emulator/account.setup.mjs',
      metadata: { email: 'e2e-vnext-production@example.test', statePath: DURABLE_STATE },
      use: { ...devices['Desktop Chrome'], baseURL: DURABLE_APP },
    },
    {
      name: 'chromium-emulator-vnext-production',
      testMatch: 'emulator/vnext-production.emulator.mjs',
      dependencies: ['emulator-vnext-production-setup'],
      metadata: { email: 'e2e-vnext-production@example.test' },
      use: { ...devices['Desktop Chrome'], baseURL: DURABLE_APP, storageState: DURABLE_STATE },
    },
    ...durableScenarioAccounts.flatMap(({ key, testMatch, grep }) => {
      const email = `e2e-vnext-production-${key}@example.test`;
      const statePath = path.join(repoRoot, `artifacts/playwright-emulator-vnext-production-${key}-state.json`);
      const setup = `emulator-vnext-production-${key}-setup`;
      return [
        { name: setup, testMatch: 'emulator/account.setup.mjs', metadata: { email, statePath },
          use: { ...devices['Desktop Chrome'], baseURL: DURABLE_APP } },
        { name: `chromium-emulator-vnext-production-${key}`, testMatch, ...(grep ? { grep } : {}),
          dependencies: [setup], metadata: { email },
          use: { ...devices['Desktop Chrome'], baseURL: DURABLE_APP, storageState: statePath } },
      ];
    }),
    // The examinee's study-record conversation (#973): the durable target, scripted readings, its own account.
    {
      name: 'emulator-actual-chat-setup',
      testMatch: 'emulator/account.setup.mjs',
      metadata: { email: 'e2e-actual-chat@example.test', statePath: ACTUAL_CHAT_STATE },
      use: { ...devices['Desktop Chrome'], baseURL: DURABLE_APP },
    },
    {
      name: 'chromium-emulator-actual-chat',
      testMatch: ['emulator/vnext-actual-record.emulator.mjs', 'emulator/vnext-actual-readback-unavailable.emulator.mjs', 'emulator/vnext-actual-saving-display.emulator.mjs'],
      dependencies: ['emulator-actual-chat-setup'],
      metadata: { email: 'e2e-actual-chat@example.test' },
      use: { ...devices['Desktop Chrome'], baseURL: DURABLE_APP, storageState: ACTUAL_CHAT_STATE },
    },
    ...actualChatScenarioAccounts.flatMap(({ key, testMatch }) => {
      const email = `e2e-actual-chat-${key}@example.test`;
      const statePath = path.join(repoRoot, `artifacts/playwright-emulator-actual-chat-${key}-state.json`);
      const setup = `emulator-actual-chat-${key}-setup`;
      return [
        { name: setup, testMatch: 'emulator/account.setup.mjs', metadata: { email, statePath },
          use: { ...devices['Desktop Chrome'], baseURL: DURABLE_APP } },
        { name: `chromium-emulator-actual-chat-${key}`, testMatch, dependencies: [setup], metadata: { email },
          use: { ...devices['Desktop Chrome'], baseURL: DURABLE_APP, storageState: statePath } },
      ];
    }),
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
    {
      // The same Worker with the durable turn job on (STUDYPLANNER_E2E_DURABLE), beside the default one.
      command: 'node tests/e2e/emulator/worker/start.mjs',
      cwd: repoRoot,
      env: DURABLE,
      wait: { stdout: /Ready on http:\/\/127\.0\.0\.1:18788/ },
      gracefulShutdown: { signal: 'SIGINT', timeout: 20_000 },
      timeout: 120_000,
    },
    {
      // The production build with VITE_DURABLE_WEEKLY_TURNS on, in its own output directory and port.
      command: 'node ./node_modules/vite/bin/vite.js build --config tests/e2e/emulator/vite.config.mjs'
        + ' && node ./node_modules/vite/bin/vite.js preview --config tests/e2e/emulator/vite.config.mjs',
      cwd: repoRoot,
      env: DURABLE,
      url: DURABLE_APP,
      reuseExistingServer: !isCi,
      timeout: 300_000,
    },
  ],
});
