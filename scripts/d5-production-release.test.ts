import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('D5 production release isolation', () => {
  it('pins the public canonical production URL while keeping test-account credentials secret', () => {
    const workflow = read('.github/workflows/d5-production-readonly-smoke.yml');
    expect(workflow).toMatch(/^\s+STUDYPLANNER_LIVE_BASE_URL: 'https:\/\/laplance\.com'\s*$/mu);
    expect(workflow).not.toContain('secrets.STUDYPLANNER_LIVE_BASE_URL');
    for (const name of ['EMAIL', 'PASSWORD', 'ACCESS_KEY']) {
      expect(workflow).toContain(`STUDYPLANNER_LIVE_${name}: \${{ secrets.STUDYPLANNER_LIVE_${name} }}`);
    }
  });

  it('changes exactly the two enabled-release Worker vars versus c309b457, and no other config', () => {
    const current = read('workers/ai-proxy/wrangler.jsonc');
    const vars = JSON.parse(current).vars;
    expect(vars.JEV_CANDIDATE_CHOICE_MODE).toBe('canary');
    expect(vars.JEV_CANDIDATE_CHOICE_CANARY_PERCENT).toBe('100');
    const restored = current.replace('"JEV_CANDIDATE_CHOICE_MODE": "canary"', '"JEV_CANDIDATE_CHOICE_MODE": "off"')
      .replace('"JEV_CANDIDATE_CHOICE_CANARY_PERCENT": "100"', '"JEV_CANDIDATE_CHOICE_CANARY_PERCENT": "0"');
    // Frozen SHA-256 of c309b457456de7ec966665f610e00791daa7cbf2:workers/ai-proxy/wrangler.jsonc.
    // Pin the complete bytes, including all other vars, bindings, migrations and triggers;
    // CI's shallow checkout need not contain historical Git objects.
    expect(createHash('sha256').update(restored).digest('hex')).toBe('0bad65f67e0fef1e00949147dee763167606e6beb7b93eb23a9fdac712449216');
  });

  it('excludes the read-only smoke from the existing live wildcard and selects it explicitly', () => {
    const live = read('tests/e2e/playwright.live.config.mjs');
    const dedicated = read('tests/e2e/playwright.d5-production.config.mjs');
    const glob = createRequire(import.meta.url)('picomatch');
    const liveMatch = live.match(/testMatch: '([^']+)'/u)![1];
    const smokeMatch = dedicated.match(/testMatch: '([^']+)'/u)![1];
    expect(glob(liveMatch)('live-account-schedule.live.mjs')).toBe(true);
    expect(glob(liveMatch)('d5-production-readonly.smoke.mjs')).toBe(false);
    expect(glob(smokeMatch)('d5-production-readonly.smoke.mjs')).toBe(true);
    expect(glob(smokeMatch)('live-account-schedule.live.mjs')).toBe(false);
    const workflow = read('.github/workflows/d5-production-readonly-smoke.yml');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('environment: live-account-verification');
    expect(workflow).toContain('--config=tests/e2e/playwright.d5-production.config.mjs d5-production-readonly.smoke.mjs');
    expect(dedicated).toContain("process.env.D5_PRODUCTION_SMOKE !== '1'");
    expect(dedicated).toContain('retries: 0');
    expect(dedicated).toContain('productionSmokeExpectation()');
    expect(workflow).toContain('default: EXPECT_JEV');
    expect(workflow).toContain('EXPECT_FALLBACK:');
    expect(workflow).toContain('expected_frontend_sha:');
    expect(workflow).toContain('EXPECTED_FRONTEND_SHA:');
    expect(workflow).toContain('if-no-files-found: error');
    expect(dedicated).toContain('requireProductionOrigin(raw)');
    expect(dedicated).toContain('verifyFrontendIdentity(process.env.EXPECTED_FRONTEND_SHA)');
    const spec = read('tests/e2e/d5-production-readonly.smoke.mjs');
    expect(spec).toContain("evidence.expectation === 'EXPECT_JEV'");
    expect(spec).not.toMatch(/inCohort5|jevPurposeCanarySample|Out of .*cohort/u);
    expect(spec).toContain('await runProductionSmoke({ evidence, body: async () => {');
    expect(spec).toContain('persist: () => persistRedactedSmokeEvidence(testInfo, evidence)');
    expect(spec).toContain('classifyFirestoreWrite({ url: request.url(), method: request.method(), postData: request.postData() })');
    expect(spec).toContain('expect(evidence.unclassifiedWrites,');
    expect(spec).toContain('waitForProductionComposer({ evidence, phase,');
    expect(spec).not.toContain('await expect(composer(page)).toBeEnabled()');
    expect(spec).not.toMatch(/page\.route\(|route\.fulfill|page\.addInitScript|timeoutMs:|devD5Domains/u);
  });

  it('keeps the production registry bundle free of dev registry/seam inputs', async () => {
    const output = await build({ absWorkingDir: root, entryPoints: ['src/features/weeklyPlanning/application/weeklyPlanningTurnApplication.ts'],
      bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser',
      define: { 'import.meta.env': '{"PROD":true,"DEV":false}' } });
    const inputs = Object.keys(output.metafile!.inputs);
    expect(inputs.some(input => input.endsWith('weeklyPlanningRegisteredCandidateDomains.ts'))).toBe(true);
    expect(inputs.filter(input => /(?:testUtils|\.test\.|\/harness\/|d5-top1-dev|candidateChoiceDev)/u.test(input))).toEqual([]);
    expect(output.outputFiles[0].text).not.toMatch(/devD5Domains|__d5ApprovalExecutions|d5-top1-dev|JEV_D5_LIVE/u);
  });
});
