import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const scripts = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts;
const ci = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

describe('verification command safety boundary', () => {
  it('verifies PR content events in drafts too without rerunning for review metadata', () => {
    const triggers = ci.match(/^on:\n([\s\S]*?)\npermissions:/m)?.[1].trimEnd();
    expect(triggers).toBe([
      '  pull_request:',
      '    branches:',
      '      - main',
      '    types:',
      '      - opened',
      '      - synchronize',
      '      - reopened',
      '  push:',
      '    branches:',
      '      - main',
      '  workflow_dispatch:',
    ].join('\n'));
  });

  it('does not replace the verify check with a skipped metadata gate or change cancellation scope', () => {
    const verifySetup = ci.match(/^  verify:\n([\s\S]*?)^    steps:/m)?.[1];
    expect(verifySetup).toBe('    runs-on: ubuntu-latest\n    timeout-minutes: 30\n');
    expect(ci.match(/^concurrency:\n([\s\S]*?)\njobs:/m)?.[1].trimEnd()).toBe([
      '  group: ci-${{ github.workflow }}-${{ github.ref }}',
      '  cancel-in-progress: true',
    ].join('\n'));
  });

  it('keeps development app and Worker checks with separate worktree caches', () => {
    expect(scripts.typecheck).toBe('npm run typecheck:app && npm run typecheck:worker');
    expect(scripts['typecheck:app']).toBe('tsc --noEmit --incremental --tsBuildInfoFile .cache/typecheck/app.tsbuildinfo');
    expect(scripts['typecheck:worker']).toBe('npm run types:worker && tsc --noEmit -p tsconfig.worker.json --incremental --tsBuildInfoFile .cache/typecheck/worker.tsbuildinfo');
  });

  it('keeps final verification fresh and complete rather than reusing development diagnostics', () => {
    expect(scripts['typecheck:app:full']).toBe('tsc --noEmit --incremental false');
    expect(scripts['typecheck:worker:full']).toBe('npm run types:worker && tsc --noEmit -p tsconfig.worker.json --incremental false');
    expect(scripts['typecheck:full']).toBe('npm run typecheck:app:full && npm run typecheck:worker:full');
    expect(scripts.verify).toBe('npm run typecheck:full && npm run test:run && npm run build');
  });

  it('keeps CI on the fresh typecheck plus full tests, rules regression and build', () => {
    for (const command of ['typecheck:full', 'test:run', 'test:firestore-rules', 'build']) {
      expect(ci).toContain('run: npm run ' + command);
    }
    expect(ci).not.toMatch(/run: npm run typecheck\s*\n/);
  });
});
