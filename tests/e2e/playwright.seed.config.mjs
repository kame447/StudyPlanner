import { defineConfig } from '@playwright/test';
import liveConfig from './playwright.live.config.mjs';

export default defineConfig({
  ...liveConfig,
  testMatch: '**/*.seed.mjs',
  timeout: 10 * 60_000,
  expect: {
    ...(liveConfig.expect ?? {}),
    timeout: 15_000,
  },
  retries: 0,
  workers: 1,
});
