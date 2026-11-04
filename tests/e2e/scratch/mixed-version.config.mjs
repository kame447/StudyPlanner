import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { RUNNER_ROOT, PAGES_ROOT, WORKER_ROOT } = process.env;
for (const [name, value] of Object.entries({ RUNNER_ROOT, PAGES_ROOT, WORKER_ROOT })) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute checkout path`);
}
// Never inherit the real-provider target from the shell.
process.env.STUDYPLANNER_E2E_REAL_API = '0';
const base = (await import(pathToFileURL(path.join(RUNNER_ROOT, 'tests/e2e/playwright.emulator.config.mjs')).href)).default;
const setup = base.projects.find(project => project.name === 'emulator-vnext-production-setup');
const production = base.projects.find(project => project.name === 'chromium-emulator-vnext-production');
if (!setup || !production || base.webServer.length !== 6) throw new Error('Unexpected emulator configuration; inspect before running');

export default {
  ...base,
  projects: [setup, { ...production, testMatch: 'scratch/mixed-version.emulator.mjs' }],
  webServer: [
    base.webServer[0],
    { ...base.webServer[1], reuseExistingServer: false },
    { ...base.webServer[4], cwd: WORKER_ROOT,
      env: { ...base.webServer[4].env, STUDYPLANNER_E2E_REAL_API: '0' } },
    { ...base.webServer[5], cwd: PAGES_ROOT, reuseExistingServer: false,
      env: { ...base.webServer[5].env, STUDYPLANNER_E2E_REAL_API: '0' } },
  ],
};
