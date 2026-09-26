import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/gemini-judge.live.ts'],
    testTimeout: 900_000,
  },
});
