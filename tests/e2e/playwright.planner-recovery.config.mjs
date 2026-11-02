import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
import { stableV5HarnessServer } from './support/stable-v5-specs.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// This candidate needs only the test harness; the normal E2E config additionally
// requires a prebuilt production preview. No production build is implied here.
export default defineConfig({
  ...base,
  testIgnore: [],
  // A project's own testMatch replaces the config-level one: name each project's specs here. The Stable V5
  // project runs only the V5-only spec this config lists; the other V5 specs need the :4178 build it never serves.
  projects: base.projects.map(project => ({ ...project,
    testMatch: project.name === 'chromium-stable-v5'
      ? ['**/ai-planning-jev-first-authority.spec.mjs']
      : ['**/planner-reconciliation-recovery.spec.mjs', '**/profile-restore-recovery.spec.mjs'] })),
  workers: 1,
  retries: 0,
  webServer: [{ command: 'node ./node_modules/vite/bin/vite.js --config tests/e2e/harness/vite.config.mjs',
    cwd: root, url: 'http://127.0.0.1:4174/full-planner-recovery.html', reuseExistingServer: false, timeout: 30_000 },
    stableV5HarnessServer(root)],
});
