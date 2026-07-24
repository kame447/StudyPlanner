import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const result = spawnSync(
  process.execPath,
  [
    './node_modules/vitest/vitest.mjs',
    '--config',
    'vite.config.mjs',
    'run',
    'src/features/weeklyPlanning/weeklyPlanningTurnController.test.ts',
  ],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  },
);
const report = {
  commit: process.env.CF_PAGES_COMMIT_SHA ?? null,
  exitCode: result.status,
  signal: result.signal,
  error: result.error?.message ?? null,
  stdout: result.stdout ?? '',
  stderr: result.stderr ?? '',
};
mkdirSync('dist', { recursive: true });
writeFileSync('dist/controller-test-report.json', `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(
  'dist/index.html',
  '<!doctype html><meta charset="utf-8"><title>Controller test report</title><a href="/controller-test-report.json">controller-test-report.json</a>',
);
console.log(JSON.stringify({ exitCode: report.exitCode, signal: report.signal, error: report.error }));
process.exit(0);
