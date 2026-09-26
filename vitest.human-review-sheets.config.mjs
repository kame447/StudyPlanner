import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/integration/human-review-sheets.generate.ts'], environment: 'node' },
});
