export default {
  testRunner: 'vitest',
  checkers: ['typescript'],
  plugins: [
    '@stryker-mutator/vitest-runner',
    '@stryker-mutator/typescript-checker',
  ],
  tsconfigFile: 'tsconfig.json',
  mutate: [
    'src/features/weeklyPlanning/semantic/weeklyPlanningFocusedAuthorizationV5.ts',
    'src/features/weeklyPlanning/semantic/weeklyPlanningCurrentTurnProvenanceV5.ts',
    'src/features/weeklyPlanning/semantic/weeklyPlanningDecisionReferenceValidationV5.ts',
    'src/features/weeklyPlanning/semantic/weeklyPlanningNumericSafetyV5.ts',
    'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticResponseValidationV5.ts',
  ],
  vitest: {
    configFile: 'vite.config.mjs',
    related: true,
  },
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: {
    fileName: 'reports/stryker/issue152-adversarial-validation.json',
  },
  incremental: true,
  incrementalFile: 'reports/stryker/issue152-adversarial-validation-incremental.json',
  concurrency: 2,
  thresholds: {
    high: 85,
    low: 70,
    break: 50,
  },
};
