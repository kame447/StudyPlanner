import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/jev-luna-comparison.live.ts'],
    testTimeout: 600_000,
  },
});
