export default {
  testRunner: 'vitest',
  checkers: ['typescript'],
  plugins: [
    '@stryker-mutator/vitest-runner',
    '@stryker-mutator/typescript-checker',
  ],
  tsconfigFile: 'tsconfig.json',
  // Preserve byte-frozen evaluation inputs; preprocess every other JS/TS file as usual.
  disableTypeChecks: '{*,!(scripts)/**/*,scripts/*,scripts/!(fixtures)/**/*}.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}',
  mutate: [
    'src/features/weeklyPlanning/semantic/weeklyPlanningPendingQuestionV5.ts',
    'src/features/weeklyPlanning/semantic/weeklyPlanningStableV5ContextualAnswer.ts',
  ],
  vitest: {
    configFile: 'vite.config.mjs',
    related: true,
  },
  reporters: ['clear-text', 'progress', 'json', 'event-recorder'],
  jsonReporter: {
    fileName: 'reports/stryker/weekly-planning.json',
  },
  // Keep the dry-run plan and individual results if the native job is cancelled.
  // These events are diagnostic evidence, not a complete mutation score.
  eventReporter: {
    baseDir: 'reports/stryker/events',
  },
  incremental: true,
  incrementalFile: 'reports/stryker/weekly-planning-incremental.json',
  concurrency: 4,
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
};
