import { defineConfig } from 'vitest/config';
export default defineConfig({
  envDir: false,
  test: {
    include: ['tests/performance/firestoreReadLoad.measurement.test.tsx'],
    pool: 'forks', maxWorkers: 1, minWorkers: 1, fileParallelism: false,
    setupFiles: ['tests/performance/firestoreReadLoad.noNetwork.ts'],
  },
});
