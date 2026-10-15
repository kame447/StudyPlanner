import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync(new URL('../../.github/workflows/ui-regression.yml', import.meta.url), 'utf8');
const block = workflow.split('      - name: Run cross-browser smoke matrix\n')[1].split('\n      - name: Upload cross-browser artifacts')[0];
const script = block.split('        run: |\n')[1].split('\n').map(line => line.slice(10)).join('\n');
const focused = "github.event_name == 'workflow_dispatch' && inputs.spec != ''";

function invoke(event, spec, { symlink = false, project = 'webkit-mobile' } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'targeted-webkit-contract-'));
  try {
    fs.mkdirSync(path.join(cwd, 'tests/e2e/node_modules/.bin'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'tests/e2e/yearly-quick-entry.spec.mjs'), '// fixture');
    if (symlink) fs.symlinkSync('yearly-quick-entry.spec.mjs', path.join(cwd, 'tests/e2e/linked.spec.mjs'));
    fs.writeFileSync(path.join(cwd, 'tests/e2e/node_modules/.bin/playwright'), '#!/usr/bin/env node\nrequire("node:fs").writeFileSync("invocation.json", JSON.stringify(process.argv.slice(2)));\n', { mode: 0o755 });
    const result = spawnSync('bash', ['-c', script], {
      cwd, encoding: 'utf8', env: { ...process.env, UI_EVENT_NAME: event, UI_SPEC: spec, UI_PROJECT: project },
    });
    return { status: result.status, stderr: result.stderr, args: fs.existsSync(path.join(cwd, 'invocation.json')) ? JSON.parse(fs.readFileSync(path.join(cwd, 'invocation.json'), 'utf8')) : null, injected: fs.existsSync(path.join(cwd, 'injected')) };
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

describe('manual targeted WebKit execution contract', () => {
  it('keeps the normal PR/main matrix and gate names while distinguishing the manual target', () => {
    expect(workflow).toContain(`project: \${{ ${focused} && fromJSON('["webkit-mobile"]') || fromJSON('["chromium-desktop","firefox-desktop","webkit-desktop","webkit-mobile"]') }}`);
    expect(workflow).toContain(`name: \${{ ${focused} && 'targeted-webkit' || 'cross-browser-projects' }} (\${{ matrix.project }})`);
    expect(workflow).toContain(`name: \${{ ${focused} && 'targeted-webkit-summary' || 'cross-browser-smoke' }}`);
    expect(workflow).toContain(`name: \${{ ${focused} && 'ui-targeted-webkit' || 'ui-cross-browser' }}-diagnostics-`);
    expect(workflow).toContain('timeout-minutes: 35');
    expect(workflow).toContain('permissions:\n  contents: read\n');
    expect(workflow).toContain('group: ui-regression-${{ github.ref }}\n  cancel-in-progress: true');
    expect(workflow).toContain('run: test "$PROJECT_RESULT" = success');
    expect(workflow).not.toMatch(/--pass-with-no-tests|continue-on-error|--timeout/);
  });
  it('runs one exact escaped spec only for a manual request', () => {
    const r = invoke('workflow_dispatch', 'yearly-quick-entry.spec.mjs');
    expect(r.status, r.stderr).toBe(0);
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
