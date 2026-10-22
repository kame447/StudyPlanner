import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../stryker.config.mjs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/test-intelligence.yml', import.meta.url), 'utf8');
const mutationJob = workflow.split('\n  mutation:\n')[1]?.split('\n  dependency-audit:\n')[0];

describe('weekly-planning mutation capacity contract', () => {
  it('keeps the detection policy while using four execution processes', () => {
    expect(config.concurrency).toBe(4);
    expect(config.mutate).toEqual([
      'src/features/weeklyPlanning/semantic/weeklyPlanningPendingQuestionV5.ts',
      'src/features/weeklyPlanning/semantic/weeklyPlanningStableV5ContextualAnswer.ts',
    ]);
    expect(config.testRunner).toBe('vitest');
    expect(config.checkers).toEqual(['typescript']);
    expect(config.tsconfigFile).toBe('tsconfig.json');
    expect(config.plugins).toEqual([
      '@stryker-mutator/vitest-runner',
      '@stryker-mutator/typescript-checker',
    ]);
    expect(config.vitest).toEqual({ configFile: 'vite.config.mjs', related: true });
    // Stryker 9.6.1 defaults to perTest; disabling coverage selection changes the gate.
    expect(config.coverageAnalysis ?? 'perTest').toBe('perTest');
    expect(config.thresholds).toEqual({ high: 80, low: 60, break: 50 });
    expect(config.mutator).toBeUndefined();
    expect(config.ignoreMutations).toBeUndefined();
    expect(config.disableTypeChecks).toBeUndefined();
  });

  it('retains complete JSON and partial events under the uploaded report directory', () => {
    expect(config.reporters).toEqual(['clear-text', 'progress', 'json', 'event-recorder']);
    expect(config.jsonReporter.fileName).toBe('reports/stryker/weekly-planning.json');
    expect(config.eventReporter?.baseDir).toBe('reports/stryker/events');
    expect(mutationJob).toMatch(/if: always\(\)[\s\S]*uses: actions\/upload-artifact@v7/);
    expect(mutationJob).toMatch(/path: reports\/stryker\//);
  });

  it('keeps the native 45-minute deadline and logs actual capacity before mutation', () => {
    expect(mutationJob).toMatch(/^    timeout-minutes: 45$/m);
    expect(mutationJob).not.toMatch(/continue-on-error:/);
    expect(mutationJob).toMatch(/nproc[\s\S]*free -m[\s\S]*npm run test:mutation:weekly-planning -- "\$MUTATION_CONFIG"/);
    expect(workflow).toContain("      - 'scripts/ci/mutation-capacity.test.mjs'");
  });
});
