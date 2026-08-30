import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '../..');
const artifactsDir = path.join(repoRoot, 'artifacts');
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: configDir,
  testIgnore: [
    '**/admin-overview-render.spec.mjs',
    '**/admin-system-environment.spec.mjs',
    '**/cross-browser-smoke.spec.mjs',
    '**/quality-gates.spec.mjs',
    '**/visual-regression.spec.mjs',
  ],
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  failOnFlakyTests: isCi,
  workers: isCi ? 1 : undefined,
  reporter: isCi
    ? [
        ['list'],
        ['json', { outputFile: path.join(artifactsDir, 'playwright-results.json') }],
        ['html', { outputFolder: path.join(artifactsDir, 'playwright-report'), open: 'never' }],
      ]
    : 'list',
  outputDir: path.join(artifactsDir, 'playwright-results'),
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run preview:vite -- --port 4173',
      cwd: repoRoot,
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
    {
      command: 'node ./node_modules/vite/bin/vite.js --config tests/e2e/harness/vite.config.mjs',
      cwd: repoRoot,
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
  ],
});