import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyChanges, isolatedSpecs, main, parseNameStatus, playwrightArgs, selectFromEvent } from './browser-regression-selection.mjs';

const roots = [];
const workflow = fs.readFileSync(new URL('../../.github/workflows/browser-regression.yml', import.meta.url), 'utf8');
function git(root, ...args) {
  return execFileSync('git', ['-c', 'user.name=Browser selection contract', '-c', 'user.email=browser-selection@example.invalid', ...args], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function write(root, file, content = '// fixture\n') {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}
function commit(root, message) {
  git(root, 'add', '.'); git(root, 'commit', '-qm', message);
  return git(root, 'rev-parse', 'HEAD');
}
function repository(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-selection-'));
  roots.push(root); git(root, 'init', '-q', '-b', 'main');
  for (const file of ['README.md', 'src/App.tsx', ...isolatedSpecs]) write(root, file);
  for (const [file, content] of Object.entries(extra)) write(root, file, content);
  return { root, base: commit(root, 'base') };
}
function push(root, before, after = git(root, 'rev-parse', 'HEAD')) {
  return selectFromEvent(root, 'push', { before, after });
}
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

describe('bounded browser input classification', () => {
  it.each(['README.md', 'AGENTS.md', 'PROJECT_MAP.md', 'docs/work/task-guide.md', '.github/ISSUE_TEMPLATE/bug.yml', '.github/CODEOWNERS', '.github/workflows/qa-result-summary.yml', 'scripts/ci/qa-result-summary-contract.test.mjs'])('does not run browsers for allowlisted non-runtime %s alone', file => {
    expect(classifyChanges([{ status: 'M', file }]).mode).toBe('none');
  });
  it.each(['src/styles/index.css', 'src/styles/appearance-pixel.css', 'src/App.tsx', 'src/main.tsx', 'src/auth/session.ts', 'src/repositories/actualRepository.ts', 'src/components/StudySessionView.test.tsx', 'workers/ai-proxy/src/index.ts', 'workers/ai-proxy/wrangler.jsonc', 'firestore.rules', 'package.json', 'package-lock.json', 'tools/firebase-tools/package-lock.json', '.node-version', 'vite.config.mjs', 'tsconfig.json', 'public/icon.png', 'scripts/preview-server.mjs', 'scripts/ci/durable-turn-runtime.mjs', 'scripts/ci/worker-image-toolchain.mjs', 'scripts/ci/deploy-firestore-rules.mjs', '.github/workflows/ci.yml', '.github/workflows/deploy-firestore-rules.yml', '.github/workflows/browser-regression.yml', 'scripts/ci/browser-regression-selection.mjs', 'tests/e2e/playwright.config.mjs', 'tests/e2e/harness/fixture.ts', 'tests/e2e/helper.mjs', 'tests/e2e/admin-overview-render.spec.mjs', 'unknown-input.txt', 'docs/runtime.json', 'src/README.md'])('retains all browser dependency/security boundaries for %s', file => {
    expect(classifyChanges([{ status: 'M', file }, { status: 'M', file: 'README.md' }], () => true).mode).toBe('full');
  });
  it('requires both reviewed path and proven isolation, and keeps all selected specs', () => {
    const changes = isolatedSpecs.map(file => ({ status: 'M', file }));
    expect(classifyChanges(changes).mode).toBe('full');
    expect(classifyChanges([...changes, { status: 'M', file: 'README.md' }], () => true)).toMatchObject({ mode: 'specs', specs: isolatedSpecs });
  });
  it.each(['A', 'D', 'T', 'R100', 'U'])('broadens a %s spec instead of hiding additions/deletions/renames/mode changes', status => {
    expect(classifyChanges([{ status, file: isolatedSpecs[0] }], () => true).mode).toBe('full');
  });
  it('does not infer a safe empty diff', () => expect(classifyChanges([]).mode).toBe('full'));
  it('parses NUL-delimited paths without line splitting', () => {
    expect(parseNameStatus('M\0src/name\nwith\ttabs.ts\0D\0README.md\0')).toEqual([{ status: 'M', file: 'src/name\nwith\ttabs.ts' }, { status: 'D', file: 'README.md' }]);
  });
  it.each(['M\0README.md', 'R100\0old\0new\0', 'M\0../outside\0', 'M\0/absolute\0', 'M\0\0', 'U\0file\0'])('rejects malformed or ambiguous diff %j', value => expect(() => parseNameStatus(value)).toThrow());
});

describe('actual Git event comparison', () => {
  it('compares the complete push range, including runtime changes before the last docs commit', () => {
    const { root, base } = repository();
    write(root, 'src/App.tsx', '// runtime changed'); commit(root, 'runtime');
    write(root, 'README.md', 'docs'); const head = commit(root, 'docs');
    const result = push(root, base, head);
    expect(result.mode).toBe('full'); expect(result.range).toBe(`${base}..${head}`);
    expect(result.changes.map(change => change.file)).toEqual(['README.md', 'src/App.tsx']);
  });
  it('uses PR merge-base changes but verifies both event commits belong to the checked-out merge', () => {
    const { root } = repository(); git(root, 'checkout', '-qb', 'feature');
    write(root, 'README.md', 'PR docs'); const head = commit(root, 'PR docs');
    git(root, 'checkout', '-q', 'main'); write(root, 'src/App.tsx', '// base change'); const base = commit(root, 'main runtime');
    git(root, 'merge', '--no-ff', '-qm', 'merge', 'feature');
    const result = selectFromEvent(root, 'pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } });
    expect(result.mode).toBe('none'); expect(result.range).toBe(`${base}...${head}`);
    expect(result.changes).toEqual([{ status: 'M', file: 'README.md' }]);
    git(root, 'checkout', '-q', head);
    expect(selectFromEvent(root, 'pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }).mode).toBe('full');
  });
  it('selects actual existing spec edits and exact scope only', () => {
    const { root, base } = repository();
    for (const file of isolatedSpecs) write(root, file, '// modified isolated test');
    commit(root, 'specs'); expect(push(root, base)).toMatchObject({ mode: 'specs', specs: isolatedSpecs });
  });
  it('broadens if another tracked module imports/re-exports an opted-in spec', () => {
    const { root, base } = repository({ 'tests/e2e/consumer.mjs': `export * from './${path.basename(isolatedSpecs[0])}';` });
    write(root, isolatedSpecs[0], '// changed'); commit(root, 'spec');
    expect(push(root, base).mode).toBe('full');
  });
  it('allows config ownership globs but broadens on a config import of the spec', () => {
    const name = path.basename(isolatedSpecs[0]);
    const { root, base } = repository({ 'tests/e2e/playwright.cross-browser.config.mjs': `const tests = ['**/${name}'];` });
    write(root, isolatedSpecs[0], '// changed'); commit(root, 'spec');
    expect(push(root, base).mode).toBe('specs');
    write(root, 'tests/e2e/playwright.cross-browser.config.mjs', `import './${name}';`); const before = commit(root, 'config import');
    write(root, isolatedSpecs[0], '// changed again'); commit(root, 'spec again');
    expect(push(root, before).mode).toBe('full');
  });
  it.each([
    "const tests = import.meta.glob('**/app-settings-page.spec.mjs');",
    "const tests = import('./' + target);",
    "const tests = require('./' + target);",
  ])('broadens when runner config has a dynamic consumer: %s', source => {
    const { root, base } = repository({ 'tests/e2e/playwright.cross-browser.config.mjs': source });
    write(root, isolatedSpecs[0], '// changed'); commit(root, 'spec');
    expect(push(root, base).mode).toBe('full');
  });
  it('does not treat a renamed/deleted spec or symlink as isolated', () => {
    const { root, base } = repository(); git(root, 'mv', isolatedSpecs[0], 'tests/e2e/moved.spec.mjs'); commit(root, 'rename');
    expect(push(root, base)).toMatchObject({ mode: 'full', changes: expect.arrayContaining([{ status: 'D', file: isolatedSpecs[0] }, { status: 'A', file: 'tests/e2e/moved.spec.mjs' }]) });
    const before = git(root, 'rev-parse', 'HEAD');
    fs.unlinkSync(path.join(root, isolatedSpecs[1])); fs.symlinkSync('moved.spec.mjs', path.join(root, isolatedSpecs[1])); commit(root, 'symlink');
    expect(push(root, before).mode).toBe('full');
  });
  it('falls back for manual, absent/zero/missing history and mismatched checkout', () => {
    const { root, base } = repository();
    expect(selectFromEvent(root, 'workflow_dispatch', {}).mode).toBe('full');
    for (const before of [undefined, '0'.repeat(40), 'f'.repeat(40), '$(touch injected)']) expect(push(root, before, base).mode).toBe('full');
    write(root, 'README.md', 'changed'); commit(root, 'docs');
    expect(push(root, base, base).mode).toBe('full');
    expect(fs.existsSync(path.join(root, 'injected'))).toBe(false);
  });
});

describe('runner and stable workflow gate', () => {
  it('uses anchored escaped exact paths with no grep, timeout, retry or no-test relaxation', () => {
    const args = playwrightArgs({ mode: 'specs', specs: isolatedSpecs });
    expect(args).toEqual(['test', '--config=tests/e2e/playwright.config.mjs', '(^|/)tests/e2e/app-settings-page\\.spec\\.mjs$', '(^|/)tests/e2e/study-session-pomodoro-settings\\.spec\\.mjs$']);
    for (const filter of args.slice(2)) {
      const regex = new RegExp(filter);
      expect(isolatedSpecs.some(file => regex.test(`/repo/${file}`))).toBe(true);
      expect(regex.test('tests/e2e/app-settings-pageXspecXmjs')).toBe(false);
      expect(regex.test('tests/e2e/app-settings-page.spec.mjs.bak')).toBe(false);
    }
    expect(playwrightArgs({ mode: 'full', specs: [] })).toEqual(args.slice(0, 2));
  });
  it('shards full selections and duplicates undersized narrowed selections without allowing no tests', () => {
    for (const shard of ['1/2', '2/2']) {
      const fullArgs = playwrightArgs({ mode: 'full', specs: [] }, shard);
      expect(fullArgs).toEqual(['test', '--config=tests/e2e/playwright.config.mjs', `--shard=${shard}`]);
      const selection = { mode: 'specs', specs: isolatedSpecs };
      expect(playwrightArgs(selection, shard)).toEqual([...playwrightArgs(selection), `--shard=${shard}`]);
      const narrow = { mode: 'specs', specs: [isolatedSpecs[0]] };
      expect(playwrightArgs(narrow, shard)).toEqual(playwrightArgs(narrow));
      expect(fullArgs).not.toContain('--pass-with-no-tests');
    }
    for (const shard of ['', '0/2', '1/0', '3/2', '01/2', '1/02', '1', '1/2/3', '1.5/2', '-1/2', ' 1/2', '1/2\n', '--shard=1/2', null]) {
      expect(() => playwrightArgs({ mode: 'full', specs: [] }, shard), String(shard)).toThrow('Invalid BROWSER_REGRESSION_SHARD');
    }
  });
  it.each([{ mode: 'none', specs: [] }, { mode: 'specs', specs: [] }, { mode: 'full', specs: ['x'] }, { mode: 'specs', specs: ['--pass-with-no-tests'] }])('rejects invalid execution receipt %j', selection => expect(() => playwrightArgs(selection)).toThrow());
  it('emits explicit none evidence and preserves a nonzero runner exit status', () => {
    const { root, base } = repository(); write(root, 'README.md', 'docs'); const head = commit(root, 'docs');
    write(root, 'event.json', JSON.stringify({ before: base, after: head }));
    const env = { GITHUB_EVENT_PATH: path.join(root, 'event.json'), GITHUB_EVENT_NAME: 'push', GITHUB_OUTPUT: path.join(root, 'outputs'), GITHUB_STEP_SUMMARY: path.join(root, 'summary') };
    expect(main(root, 'select', env)).toBe(0);
    expect(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8')).toBe('mode=none\n');
    expect(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8')).toContain('not a full-browser pass');
    expect(() => main(root, 'run')).toThrow('Invalid browser execution selection');
    write(root, 'artifacts/browser-selection.json', JSON.stringify({ mode: 'specs', specs: isolatedSpecs }));
    write(root, 'runner-listing', JSON.stringify({ suites: [{ suites: [{ specs: [{ tests: [{}] }] }] }], errors: [] }));
    write(root, 'tests/e2e/node_modules/.bin/playwright', '#!/bin/sh\nfor arg do\n  if [ "$arg" = "--list" ]; then cat runner-listing; exit 0; fi\ndone\nprintf "%s\\n" "$@" > runner-args\nexit 17\n'); fs.chmodSync(path.join(root, 'tests/e2e/node_modules/.bin/playwright'), 0o755);
    expect(main(root, 'run', { BROWSER_REGRESSION_SHARD: '2/2' })).toBe(17);
    expect(fs.readFileSync(path.join(root, 'runner-args'), 'utf8')).toContain('--shard=2/2\n');
    write(root, 'artifacts/browser-selection.json', JSON.stringify({ mode: 'specs', specs: [isolatedSpecs[0]] }));
    expect(main(root, 'run', { BROWSER_REGRESSION_SHARD: '2/2' })).toBe(17);
    expect(fs.readFileSync(path.join(root, 'runner-args'), 'utf8').trim().split('\n'))
      .toEqual(playwrightArgs({ mode: 'specs', specs: [isolatedSpecs[0]] }));
    fs.unlinkSync(path.join(root, 'runner-args'));
    expect(() => main(root, 'run', { BROWSER_REGRESSION_SHARD: '3/2' })).toThrow('Invalid BROWSER_REGRESSION_SHARD');
    expect(fs.existsSync(path.join(root, 'runner-args'))).toBe(false);
    write(root, 'artifacts/browser-selection.json', JSON.stringify({ mode: 'full', specs: [] }));
    for (const listing of [
      { suites: [], errors: [] },
      { suites: [{ specs: [{ tests: [] }] }], errors: [] },
      { suites: [{ specs: [{ tests: [{}] }] }], errors: [{ message: 'load error' }] },
    ]) {
      write(root, 'runner-listing', JSON.stringify(listing));
      expect(() => main(root, 'run', { BROWSER_REGRESSION_SHARD: '2/2' })).toThrow('Empty or invalid browser shard listing');
      expect(fs.existsSync(path.join(root, 'runner-args'))).toBe(false);
    }
  });
  it('fails on unreadable/malformed event data instead of emitting none', () => {
    const { root } = repository(); write(root, 'broken.json', '{');
    expect(() => main(root, 'select', { GITHUB_EVENT_PATH: path.join(root, 'broken.json') })).toThrow();
    expect(fs.existsSync(path.join(root, 'artifacts/browser-selection.json'))).toBe(false);
  });
  it('retains the existing chromium check, triggers and timeout and conditions all expensive steps', () => {
    expect(workflow).toContain('  chromium-shard:\n    name: chromium (shard ${{ matrix.shard }}/2)\n    runs-on: ubuntu-latest\n    timeout-minutes: 30');
    expect(workflow).toContain('fail-fast: false\n      matrix:\n        shard: [1, 2]');
    expect(workflow).toContain('BROWSER_REGRESSION_SHARD: ${{ matrix.shard }}/2');
    expect(workflow.match(/BROWSER_REGRESSION_SHARD:/g)).toHaveLength(1);
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).not.toMatch(/paths:|paths-ignore:|continue-on-error|pass-with-no-tests|pull_request_target/);
    for (const name of ['Install application dependencies', 'Snapshot application manifests before isolated test-runner install', 'Install isolated Playwright test runner', 'Verify isolated test-runner install did not mutate application manifests', 'Install Chromium', 'Build production bundle', 'Run browser regression tests']) {
      expect(workflow).toContain(`      - name: ${name}\n        if: steps.selection.outputs.mode != 'none'`);
    }
    expect(workflow).toContain('run: node scripts/ci/browser-regression-selection.mjs select');
    expect(workflow).toContain('run: node scripts/ci/browser-regression-selection.mjs run');
    for (const artifact of ['browser-selection', 'browser-regression-artifacts', 'browser-ui-images']) {
      expect(workflow).toContain(`name: ${artifact}-\${{ github.sha }}-shard-\${{ matrix.shard }}`);
    }
    expect(workflow).toContain('  chromium:\n    name: chromium\n    needs: chromium-shard\n    if: always()');
    expect(workflow).toContain('SHARD_RESULT: ${{ needs.chromium-shard.result }}');
    const gate = workflow.split('      - name: Require every Chromium shard to succeed\n')[1].split('        run: |\n')[1];
    for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
      expect(spawnSync('bash', ['-c', gate], { env: { ...process.env, SHARD_RESULT: result } }).status, result)
        .toBe(result === 'success' ? 0 : 1);
    }
    expect(workflow).toContain('if-no-files-found: error');
    expect(workflow).toContain('permissions:\n  contents: read');
  });
  it('keeps the opt-in specs in the ordinary Chromium configuration', () => {
    const config = fs.readFileSync(new URL('../../tests/e2e/playwright.config.mjs', import.meta.url), 'utf8');
    const ignored = config.split('testIgnore: [')[1].split('],')[0];
    for (const file of isolatedSpecs) expect(ignored).not.toContain(path.basename(file));
  });
});
