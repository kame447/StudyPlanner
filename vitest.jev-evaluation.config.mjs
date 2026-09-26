import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/jev-shadow-evaluation.live.ts'],
    testTimeout: 180_000,
  },
});
