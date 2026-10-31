import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync(new URL('../../.github/workflows/ui-quality-automation.yml', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../../tests/e2e/playwright.cross-browser.config.mjs', import.meta.url), 'utf8');
const stability = workflow.split('\n  stability-repeat:\n')[1].split(/\n {2}[a-z-]+:\n/)[0];
const legs = [...stability.matchAll(/- \{ project: ([a-z-]+), shard: (\d+), shards: (\d+) \}/g)]
  .map(([, project, shard, shards]) => ({ project, shard: Number(shard), shards: Number(shards) }));
const configProjects = [...config.split('projects: [')[1].matchAll(/name: '([a-z-]+)'/g)].map(([, name]) => name);

describe('stability-repeat sharding contract (#945)', () => {
  it('runs every cross-browser project, each as a complete set of shards', () => {
    expect([...new Set(legs.map(({ project }) => project))].sort()).toEqual([...configProjects].sort());
    for (const project of configProjects) {
      const own = legs.filter((leg) => leg.project === project);
      const shards = own[0].shards;
      expect(own.every((leg) => leg.shards === shards), project).toBe(true);
      expect(own.map(({ shard }) => shard).sort((a, b) => a - b), project)
        .toEqual(Array.from({ length: shards }, (_, index) => index + 1));
    }
  });

  it('repeats through the shard guard without retries, within the unchanged budget', () => {
    expect(stability).toContain('run: node scripts/ci/playwright-shard.mjs test --config=tests/e2e/playwright.cross-browser.config.mjs "--project=$STABILITY_PROJECT" "--shard=$STABILITY_SHARD" --repeat-each=3 --retries=0');
    expect(stability).toContain('STABILITY_SHARD: ${{ matrix.shard }}/${{ matrix.shards }}');
    expect(stability).toContain('timeout-minutes: 30\n');
    expect(stability).toContain('fail-fast: false');
    expect(stability).not.toMatch(/--pass-with-no-tests|continue-on-error|--timeout|--grep|--max-failures/);
    expect(stability).toContain('name: ui-stability-${{ github.sha }}-${{ matrix.project }}-shard-${{ matrix.shard }}');
  });
});
