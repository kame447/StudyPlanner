export default {
  testRunner: 'vitest',
  checkers: ['typescript'],
  plugins: [
    '@stryker-mutator/vitest-runner',
    '@stryker-mutator/typescript-checker',
  ],
  tsconfigFile: 'tsconfig.json',
  mutate: [
    'src/features/weeklyPlanning/semantic/weeklyPlanningPendingQuestionV5.ts',
    'src/features/weeklyPlanning/semantic/weeklyPlanningStableV5ContextualAnswer.ts',
  ],
  vitest: {
    configFile: 'vite.config.mjs',
    related: true,
  },
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: 'reports/stryker/weekly-planning.json',
  },
  incremental: true,
  incrementalFile: 'reports/stryker/weekly-planning-incremental.json',
  concurrency: 2,
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
};
