import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// This candidate needs only the test harness; the normal E2E config additionally
// requires a prebuilt production preview. No production build is implied here.
export default defineConfig({
  ...base,
  testMatch: '**/planner-reconciliation-recovery.spec.mjs',
  testIgnore: [],
  workers: 1,
  retries: 0,
  webServer: [{ command: 'node ./node_modules/vite/bin/vite.js --config tests/e2e/harness/vite.config.mjs',
    cwd: root, url: 'http://127.0.0.1:4174/full-planner-recovery.html', reuseExistingServer: false, timeout: 30_000 }],
});
