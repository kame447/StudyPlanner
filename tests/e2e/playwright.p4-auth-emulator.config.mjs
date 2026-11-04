import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from './playwright.emulator.config.mjs';

const setup = base.projects.find(project => project.name === 'emulator-vnext-production-setup');
const production = base.projects.find(project => project.name === 'chromium-emulator-vnext-production');
if (!setup || !production) throw new Error('Missing durable VNext emulator setup or project');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const statePath = path.join(repoRoot, 'artifacts/playwright-emulator-p4-auth-state.json');
const email = 'e2e-p4-durable-auth@example.test';

export default defineConfig({
  ...base,
  projects: [
    { ...setup, name: 'emulator-p4-auth-setup', metadata: { email, statePath } },
    { ...production, name: 'chromium-emulator-p4-auth',
      testMatch: 'emulator/vnext-durable-auth-denied.emulator.mjs',
      dependencies: ['emulator-p4-auth-setup'], metadata: { email },
      use: { ...production.use, storageState: statePath } },
  ],
});
