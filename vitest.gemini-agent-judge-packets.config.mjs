import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/gemini-agent-judge.packets.ts'],
    environment: 'node',
  },
});
