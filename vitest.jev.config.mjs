import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/integration/jev-openrouter.live.ts'], environment: 'node' },
});
