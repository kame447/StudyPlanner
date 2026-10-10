import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
const correctionRealApi = process.env.STUDYPLANNER_CORRECTION_REAL_API === '1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// This candidate needs only the test harness; the normal E2E config additionally
// requires a prebuilt production preview. No production build is implied here.
export default defineConfig({
  ...base,
  testMatch: correctionRealApi
    ? '**/weekly-correction-integrity.real-api.mjs'
    : '**/planner-reconciliation-recovery.spec.mjs',
  testIgnore: [],
  workers: 1,
  retries: 0,
  ...(correctionRealApi ? {
    repeatEach: 1, maxFailures: 1, timeout: 600_000, globalTimeout: 660_000,
    reporter: 'list',
    outputDir: path.join(root, 'artifacts/weekly-correction-real-api/results'),
    // APIRequestContext headers must never enter a trace/HAR/video artifact.
    use: { ...base.use, trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block',
      // Chromium, like Vite, must not inherit the Node transport credential.
      launchOptions: { env: { ...process.env, OPENAI_API_KEY: '', VITE_AI_API_KEY: '' } },
    },
  } : {}),
  webServer: [{ command: 'node ./node_modules/vite/bin/vite.js --config tests/e2e/harness/vite.config.mjs',
    ...(correctionRealApi ? { env: {
      STUDYPLANNER_CORRECTION_REAL_API: '1',
      OPENAI_API_KEY: '', VITE_AI_API_KEY: '',
    } } : {}),
    cwd: root, url: 'http://127.0.0.1:4174/full-planner-recovery.html', reuseExistingServer: false, timeout: 30_000 }],
});
