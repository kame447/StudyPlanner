import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import existing from './playwright.emulator.config.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const statePath = path.join(root, 'artifacts/conversation-sync-account.json');
export default defineConfig({
  ...existing,
  reporter: [['list'], ['json', { outputFile: path.join(root, 'artifacts/conversation-sync-app-results.json') }]],
  outputDir: path.join(root, 'artifacts/conversation-sync-app-results'),
  projects: [
    { name: 'conversation-sync-setup', testMatch: 'emulator/account.setup.mjs',
      metadata: { email: 'e2e-conversation-sync@example.test', statePath }, use: { ...devices['Desktop Chrome'] } },
    { name: 'conversation-sync-app', testMatch: 'emulator/conversation-sync.emulator.mjs',
      dependencies: ['conversation-sync-setup'],
      metadata: { email: 'e2e-conversation-sync@example.test' },
      use: { ...devices['Desktop Chrome'], storageState: statePath } },
  ],
  webServer: existing.webServer.slice(0, 4).map(server => ({ ...server, reuseExistingServer: false })),
});
