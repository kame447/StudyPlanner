import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { openai } from '@ai-sdk/openai';
import { chatgpt } from 'e2e/oauth/chatgpt';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(projectDir, '../..');

export default {
  tests: 'tests/**/*.e2e.ts',
  targets: [{
    name: 'weekly-local-harness',
    engine: web({ browser: 'chromium', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' }),
    app: {
      url: 'http://127.0.0.1:4174',
      readyUrl: 'http://127.0.0.1:4174/real-weekly.html',
      command: {
        executable: process.execPath,
        args: ['./node_modules/vite/bin/vite.js', '--config', 'tests/e2e/harness/vite.config.mjs'],
        cwd: repositoryRoot,
        startupTimeout: 90_000,
        log: '.e2e/logs/app.log',
      },
    },
  }],
  timeout: 120_000,
  workers: 1,
  retries: 0,
  trace: 'retain-on-failure',
  cache: process.env.CI ? 'off' : 'read-write',
  agents: {
    default: {
      model: process.env.LAPLANCE_AGENT_E2E_AUTH === 'chatgpt'
        ? chatgpt('gpt-6-luna')
        : openai(process.env.LAPLANCE_AGENT_E2E_MODEL?.trim() || 'gpt-5-mini'),
      system: 'You test the Laplance Japanese planning UI. Carry out only the requested user interaction. Never approve or save a plan unless explicitly requested. Do not use test-only hooks or internal application state.',
    },
  },
} satisfies E2EConfig;
