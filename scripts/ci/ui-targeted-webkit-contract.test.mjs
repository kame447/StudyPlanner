import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync(new URL('../../.github/workflows/ui-regression.yml', import.meta.url), 'utf8');
const block = workflow.split('      - name: Run cross-browser smoke matrix\n')[1].split('\n      - name: Upload cross-browser artifacts')[0];
const script = block.split('        run: |\n')[1].split('\n').map(line => line.slice(10)).join('\n');
const focused = "github.event_name == 'workflow_dispatch' && inputs.spec != ''";

function invoke(event, spec, { symlink = false, project = 'webkit-mobile', shard = '', listing = { suites: [{ suites: [{ specs: [{ tests: [{}] }] }] }], errors: [] }, listingStatus = 0, runnerStatus = 0 } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'targeted-webkit-contract-'));
  try {
    fs.mkdirSync(path.join(cwd, 'tests/e2e/node_modules/.bin'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'tests/e2e/yearly-quick-entry.spec.mjs'), '// fixture');
    if (symlink) fs.symlinkSync('yearly-quick-entry.spec.mjs', path.join(cwd, 'tests/e2e/linked.spec.mjs'));
    fs.mkdirSync(path.join(cwd, 'scripts/ci'), { recursive: true });
    fs.copyFileSync(new URL('./playwright-shard.mjs', import.meta.url), path.join(cwd, 'scripts/ci/playwright-shard.mjs'));
    fs.writeFileSync(path.join(cwd, 'runner-listing.json'), JSON.stringify(listing));
    fs.writeFileSync(path.join(cwd, 'tests/e2e/node_modules/.bin/playwright'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--list')) {
  fs.writeFileSync('listing-args.json', JSON.stringify(args));
  process.stdout.write(fs.readFileSync('runner-listing.json'));
  process.exit(${listingStatus});
}
fs.writeFileSync('invocation.json', JSON.stringify(args));
process.exit(${runnerStatus});
`, { mode: 0o755 });
    const result = spawnSync('bash', ['-c', script], {
      cwd, encoding: 'utf8', env: { ...process.env, UI_EVENT_NAME: event, UI_SPEC: spec, UI_PROJECT: project, UI_REGRESSION_SHARD: shard },
    });
    return { status: result.status, stderr: result.stderr, stdout: result.stdout, listed: fs.existsSync(path.join(cwd, 'listing-args.json')) ? JSON.parse(fs.readFileSync(path.join(cwd, 'listing-args.json'), 'utf8')) : null, args: fs.existsSync(path.join(cwd, 'invocation.json')) ? JSON.parse(fs.readFileSync(path.join(cwd, 'invocation.json'), 'utf8')) : null, injected: fs.existsSync(path.join(cwd, 'injected')) };
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

describe('manual targeted WebKit execution contract', () => {
  it('keeps the normal PR/main matrix and gate names while distinguishing the manual target', () => {
    expect(workflow).toContain(`name: \${{ ${focused} && 'targeted-webkit' || 'cross-browser-projects' }} (\${{ matrix.project }})\${{ matrix.shard && format(' (shard {0}/2)', matrix.shard) || '' }}`);
    expect(workflow).toContain(`name: \${{ ${focused} && 'targeted-webkit-summary' || 'cross-browser-smoke' }}`);
    expect(workflow).toContain(`name: \${{ ${focused} && 'ui-targeted-webkit' || 'ui-cross-browser' }}-diagnostics-`);
    expect(workflow).toContain('timeout-minutes: 35');
    expect(workflow).toContain('permissions:\n  contents: read\n');
    expect(workflow.match(/^concurrency:\n([\s\S]*?)\njobs:/m)?.[1].trimEnd()).toBe([
      `  group: \${{ ${focused} && 'ui-targeted-webkit' || 'ui-regression' }}-\${{ github.ref }}`,
      '  cancel-in-progress: true',
    ].join('\n'));
    expect(workflow).toContain('run: test "$PROJECT_RESULT" = success');
    expect(workflow).not.toMatch(/--pass-with-no-tests|continue-on-error|--timeout/);
  });
  it('runs one exact escaped spec only for a manual request', () => {
    const r = invoke('workflow_dispatch', 'yearly-quick-entry.spec.mjs', { shard: '2/2', listing: { suites: [], errors: [] } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.listed).toBe(null);
    expect(r.stdout).toContain('Playwright execution: unsharded');
    expect(r.args).toEqual(['test', '--config=tests/e2e/playwright.cross-browser.config.mjs', '--project=webkit-mobile', '(^|/)yearly-quick-entry\\.spec\\.mjs$']);
  });
  it('keeps the full selected project when the manual spec is empty', () => {
    const r = invoke('workflow_dispatch', '', { project: 'firefox-desktop' });
    expect(r.status).toBe(0);
    expect(r.args).toEqual(['test', '--config=tests/e2e/playwright.cross-browser.config.mjs', '--project=firefox-desktop']);
  });
  it.each(['pull_request', 'push'])('ignores any spec input on %s and retains the full project', event => {
    const r = invoke(event, ';touch injected');
    expect(r.status).toBe(0);
    expect(r.args).toHaveLength(3);
    expect(r.injected).toBe(false);
  });
  it.each(['../yearly-quick-entry.spec.mjs', 'yearly-quick-entry.spec.mjs;touch injected', '$(touch injected)', 'yearly-.*.spec.mjs', 'missing.spec.mjs', '--project=chromium-desktop', 'yearly-quick-entry.spec.mjs\nother.spec.mjs'])('rejects invalid, non-exact, or absent target %j before invoking the runner', spec => {
    const r = invoke('workflow_dispatch', spec);
    expect(r.status).toBe(2);
    expect(r.args).toBe(null);
    expect(r.injected).toBe(false);
  });
  it('rejects a symlink target', () => {
    const r = invoke('workflow_dispatch', 'linked.spec.mjs', { symlink: true });
    expect(r.status).toBe(2);
    expect(r.args).toBe(null);
  });
});

// Evaluate only the small boolean/string expression used by this workflow. The
// fixtures use the same literal event, input and ref values as GitHub's contexts.
function concurrencyGroup(event, spec, ref) {
  const group = workflow.match(/^concurrency:\n  group: (.+)$/m)?.[1];
  expect(group).toBeTruthy();
  return group.replace(/\$\{\{ (.*?) \}\}/g, (_, expression) =>
    new Function('github', 'inputs', `return (${expression});`)({ event_name: event, ref }, { spec }));
}

describe('full and targeted Matrix concurrency boundaries', () => {
  it.each(['refs/heads/main', 'refs/heads/review-branch'])('isolates targeted dispatch from full dispatch on %s', ref => {
    expect(concurrencyGroup('workflow_dispatch', 'yearly-quick-entry.spec.mjs', ref))
      .not.toBe(concurrencyGroup('workflow_dispatch', '', ref));
  });
  it('isolates a targeted main dispatch from a main push', () => {
    expect(concurrencyGroup('workflow_dispatch', 'yearly-quick-entry.spec.mjs', 'refs/heads/main'))
      .not.toBe(concurrencyGroup('push', '', 'refs/heads/main'));
  });
  it('preserves ordinary same-ref replacement and the original group identity', () => {
    const ref = 'refs/heads/main';
    expect(concurrencyGroup('push', '', ref)).toBe('ui-regression-' + ref);
    expect(concurrencyGroup('workflow_dispatch', '', ref)).toBe(concurrencyGroup('push', '', ref));
    expect(concurrencyGroup('pull_request', 'ignored-input', 'refs/pull/714/merge'))
      .toBe('ui-regression-refs/pull/714/merge');
  });
  it('keeps targeted runs in their own bounded same-ref replacement group', () => {
    const ref = 'refs/heads/review-branch';
    expect(concurrencyGroup('workflow_dispatch', 'yearly-quick-entry.spec.mjs', ref))
      .toBe('ui-targeted-webkit-' + ref);
    expect(concurrencyGroup('workflow_dispatch', 'month-event-range.spec.mjs', ref))
      .toBe(concurrencyGroup('workflow_dispatch', 'yearly-quick-entry.spec.mjs', ref));
  });
});

// Exercise the exact matrix expression, then drive the workflow shell with a
// synthetic runner. No browser or server starts in these contract tests.
function matrixLegs(event, spec) {
  const expression = workflow.match(/        include: \$\{\{ (.*?) \}\}/)?.[1];
  expect(expression).toBeTruthy();
  return new Function('github', 'inputs', 'fromJSON', `return (${expression});`)(
    { event_name: event }, { spec }, JSON.parse,
  );
}

describe('cross-browser mobile shard workflow contract', () => {
  const full = [
    { project: 'chromium-desktop', shard: '' },
    { project: 'firefox-desktop', shard: '' },
    { project: 'webkit-desktop', shard: '' },
    { project: 'webkit-mobile', shard: 1 },
    { project: 'webkit-mobile', shard: 2 },
  ];
  it.each(['push', 'pull_request', 'workflow_dispatch'])('splits only mobile for a full %s run', event => {
    expect(matrixLegs(event, '')).toEqual(full);
  });
  it.each(['push', 'pull_request'])('does not select targeted execution from spec input on %s', event => {
    expect(matrixLegs(event, 'yearly-quick-entry.spec.mjs')).toEqual(full);
  });
  it('keeps a single unsharded targeted leg', () => {
    expect(matrixLegs('workflow_dispatch', 'yearly-quick-entry.spec.mjs')).toEqual([{ project: 'webkit-mobile', shard: '' }]);
  });
  it('keeps unique shard artifacts, isolated runner setup, retention and timeout', () => {
    const projects = workflow.split('  cross-browser-projects:\n')[1].split('  cross-browser-smoke:')[0];
    expect(projects).toContain('timeout-minutes: 35');
    expect(projects).toContain('fail-fast: false');
    expect(projects).toContain("UI_REGRESSION_SHARD: ${{ matrix.shard && format('{0}/2', matrix.shard) || '' }}");
    const artifacts = [...projects.matchAll(/          name: (.+)/g)].map(match => match[1]);
    expect(artifacts).toHaveLength(3);
    for (const artifact of artifacts) expect(artifact).toContain("${{ matrix.shard && format('-shard-{0}', matrix.shard) || '' }}");
    expect(projects.match(/retention-days: 14/g)).toHaveLength(3);
    expect(projects).toContain('run: npm ci');
    expect(projects).toContain('run: npm install --prefix tests/e2e --no-save --package-lock=false @playwright/test@1.64.0');
    expect(projects).not.toMatch(/playwright install(?:\s|$)/);
    expect(projects).toContain('run: sha256sum -c /tmp/studyplanner-manifests.sha256');
    expect(projects).toContain('run: npm run build');
  });
  it.each(['1/2', '2/2'])('preflights a nonempty full mobile shard %s before running it', shard => {
    const r = invoke('push', '', { shard, runnerStatus: 17 });
    expect(r.status).toBe(17);
    expect(r.args.at(-1)).toBe(`--shard=${shard}`);
    expect(r.listed).toEqual([...r.args, '--list', '--reporter=json']);
    expect(r.stdout).toContain(`Playwright execution: sharded ${shard}`);
  });
  it('also shards blank-spec manual mobile runs', () => {
    const r = invoke('workflow_dispatch', '', { shard: '2/2' });
    expect(r.status).toBe(0);
    expect(r.args.at(-1)).toBe('--shard=2/2');
    expect(r.listed).not.toBe(null);
  });
  it('fails an empty mobile shard without starting the actual run', () => {
    const r = invoke('push', '', { shard: '2/2', listing: { suites: [], errors: [] } });
    expect(r.status).toBe(1);
    expect(r.args).toBe(null);
    expect(r.listed).not.toBe(null);
  });
  it('rejects a malformed shard before invoking Playwright', () => {
    const r = invoke('push', '', { shard: '3/2' });
    expect(r.status).toBe(1);
    expect(r.args).toBe(null);
    expect(r.listed).toBe(null);
  });
  it('propagates listing failure without starting the actual run', () => {
    const r = invoke('push', '', { shard: '1/2', listingStatus: 23 });
    expect(r.status).toBe(23);
    expect(r.args).toBe(null);
  });
  it.each(['chromium-desktop', 'firefox-desktop', 'webkit-desktop'])('keeps %s unsharded without listing', project => {
    const r = invoke('push', '', { project, listing: { suites: [], errors: [] } });
    expect(r.status).toBe(0);
    expect(r.listed).toBe(null);
    expect(r.args).toEqual(['test', '--config=tests/e2e/playwright.cross-browser.config.mjs', `--project=${project}`]);
  });
  it('requires success from the complete matrix, including both mobile shards', () => {
    const gate = workflow.split('  cross-browser-smoke:\n')[1];
    expect(gate).toContain('if: ${{ always() &&');
    expect(gate).toContain('needs: cross-browser-projects');
    expect(gate).toContain('PROJECT_RESULT: ${{ needs.cross-browser-projects.result }}');
    const command = gate.match(/        run: (.+)/)?.[1];
    for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
      expect(spawnSync('bash', ['-c', command], { env: { ...process.env, PROJECT_RESULT: result } }).status, result)
        .toBe(result === 'success' ? 0 : 1);
    }
  });
});


describe('preinstalled cross-browser image contract', () => {
  const projects = workflow.split('  cross-browser-projects:\n')[1].split('  cross-browser-smoke:')[0];

  it('uses the official Noble image with the exact separately installed runner version', () => {
    const imageVersion = projects.match(/^      image: mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble$/m)?.[1];
    const runnerVersion = projects.match(/npm install --prefix tests\/e2e --no-save --package-lock=false @playwright\/test@(\d+\.\d+\.\d+)(?:\n|$)/)?.[1];
    expect(imageVersion).toBeTruthy();
    expect(runnerVersion).toBeTruthy();
    expect(imageVersion).toBe(runnerVersion);
  });

  it('retains the original non-root container boundary without additional capabilities', () => {
    const container = projects.match(/^    container:\n((?:      .+\n)+)/m)?.[1];
    expect(container).toBeTruthy();
    expect(container.trimEnd().split('\n')).toEqual([
      '      image: mcr.microsoft.com/playwright:v1.64.0-noble',
      '      options: --user 1001',
    ]);
  });

  it('leaves visual comparison on its original host and Chromium installation', () => {
    const visual = workflow.split('  visual-regression:\n')[1].split('  cross-browser-projects:')[0];
    expect(visual).not.toMatch(/^    container:/m);
    expect(visual).toContain('run: ./tests/e2e/node_modules/.bin/playwright install --with-deps chromium');
    expect(visual).toContain('timeout-minutes: 25');
    expect(visual).toContain('run: ./tests/e2e/node_modules/.bin/playwright test --config=tests/e2e/playwright.visual.config.mjs');
  });
});
