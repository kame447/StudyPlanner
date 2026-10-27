import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import issue152 from '../../stryker.issue152.config.mjs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/test-intelligence.yml', import.meta.url), 'utf8');
const job = name => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z-]+:\n/)[0];
const selected = (name, event, suite) => {
  const condition = job(name).match(/^    if: (.+)$/m)[1].replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  return vm.runInNewContext(condition, { github: { event_name: event }, inputs: { suite }, always: () => true }, { timeout: 100 });
};

describe('native mutation partition orchestration', () => {
  it.each([
    ['pull_request', undefined, true, true], ['schedule', undefined, true, true],
    ['workflow_dispatch', 'all', true, true], ['workflow_dispatch', 'mutation', true, true],
    ['workflow_dispatch', 'mutation-issue152', false, true],
    ['workflow_dispatch', 'coverage', false, false], ['workflow_dispatch', 'audit', false, false],
  ])('selects the correct workers and final gate for%s/%s', (event, suite, weekly, gate) => {
    expect(selected('mutation-plan', event, suite)).toBe(weekly);
    expect(selected('mutation-shard', event, suite)).toBe(weekly);
    expect(selected('mutation', event, suite)).toBe(gate);
  });
  it('keeps a single visible mutation gate that runs after failed or skipped needs', () => {
    const gate = job('mutation');
    expect(gate).toContain('needs: [mutation-plan, mutation-shard]');
    expect(gate).toMatch(/if: \$\{\{ always\(\) &&/);
    expect(gate).toContain('MUTATION_PLAN_RESULT: ${{ needs.mutation-plan.result }}');
    expect(gate).toContain('MUTATION_SHARDS_RESULT: ${{ needs.mutation-shard.result }}');
    expect(gate).toContain('--partition aggregate');
    expect(workflow.match(/^  mutation:$/gm)).toHaveLength(1);
  });
  it('keeps both cold workers within the original deadline and preserves partial failures', () => {
    const shard = job('mutation-shard');
    expect(shard).toContain('timeout-minutes: 45');
    expect(shard).toContain('fail-fast: false');
    expect(shard).toContain('max-parallel: 2');
    expect(shard).toContain('shard: [a, b]');
    expect(workflow).not.toContain('continue-on-error:');
    for (const name of ['mutation-plan', 'mutation-shard', 'mutation']) {
      expect(job(name)).toMatch(/fetch-depth: 0[\s\S]*persist-credentials: false/);
      expect(job(name)).toContain('if: always()');
      expect(job(name)).toContain('sha256sum -c /tmp/studyplanner-manifests.sha256');
      expect(job(name)).toContain('locked-test-toolchain.mjs verify');
    }
  });
  it('isolates current-attempt artifacts and preserves the legacy ZIP root and name', () => {
    const gate = job('mutation');
    expect(gate).toContain('name: mutation-weekly-planning-shard-a-${{ github.sha }}-${{ github.run_attempt }}');
    expect(gate).toContain('name: mutation-weekly-planning-shard-b-${{ github.sha }}-${{ github.run_attempt }}');
    expect(gate).toContain('name: mutation-weekly-planning-inventory-${{ github.sha }}-${{ github.run_attempt }}');
    expect(gate).toMatch(/name: \$\{\{ env.MUTATION_ARTIFACT \}\}-\$\{\{ github.sha \}\}[\s\S]*overwrite: true[\s\S]*path: reports\/stryker\//);
    expect(gate).toContain('retention-days: 30');
  });
  it('keeps Issue152 on its unchanged unsharded contract despite skipped weekly needs', () => {
    const gate = job('mutation');
    expect(gate).toMatch(/name: Run isolated pinned mutation toolchain\n\s+if: inputs.suite == 'mutation-issue152'\n\s+run: npm run test:mutation:weekly-planning -- "\$MUTATION_CONFIG"/);
    expect(gate).toContain("'stryker.issue152.config.mjs' || 'stryker.config.mjs'");
    expect(gate).toContain("'mutation-issue152' || 'mutation-weekly-planning'");
    expect(issue152.thresholds).toEqual({ high: 85, low: 70, break: 50 });
    expect(issue152.concurrency).toBe(2);
    expect(issue152.mutate).toHaveLength(5);
  });
  it('runs for every new helper and regression instead of leaving trigger gaps', () => {
    for (const file of ['isolated-mutation-toolchain.mjs', 'mutation-partition.mjs', 'mutation-partition.test.mjs', 'run-mutation-partition.mjs', 'mutation-partition-worker.mjs', 'mutation-partition-worker.test.mjs', 'mutation-partition-reporter.mjs', 'mutation-partition-reporter.test.mjs', 'mutation-partition-plugin.mjs', 'mutation-partition-workflow.test.mjs']) {
      expect(workflow).toContain(`      - 'scripts/ci/${file}'`);
    }
  });
});
