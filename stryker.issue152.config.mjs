// Issue #152 security-module mutation config. It is not part of the default PR
// mutation run (about 39 min against the 45 min job timeout). Run it through
// Test Intelligence with workflow_dispatch suite=mutation-issue152, or locally
// with main's pinned npx toolchain:
//   npx --yes --package=@stryker-mutator/core@9.6.1 --package=@stryker-mutator/vitest-runner@9.6.1 --package=@stryker-mutator/typescript-checker@9.6.1 stryker run stryker.issue152.config.mjs
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
