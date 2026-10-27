import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.planner-recovery.config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export default defineConfig({
  ...base,
  testMatch: '**/fixed-event-registration.incident.spec.mjs',
  timeout: 300_000,
  outputDir: path.join(root, `artifacts/incident20261026/browser-${process.env.INCIDENT_LIVE === '1' ? 'live' : process.env.INCIDENT_REPLAY === '1' ? 'replay' : 'injected'}`),
  reporter: [['list'], ['json', { outputFile: path.join(root, 'artifacts/incident20261026/e2e-results.json') }]],
  use: { ...base.use, timezoneId: 'Asia/Tokyo', video: 'off', trace: 'retain-on-failure' },
});
