import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const MAX_OUTPUT_CHARS = 120_000;

const focusedTests = [
  'src/features/weeklyPlanning/weeklyPlanningTurnController.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceSessionStorage.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningTraceRemoteRepository.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRemoteContinuity.integration.test.ts',
  'src/features/weeklyPlanning/__tests__/weeklyPlanningStableV5ConversationTrace.integration.test.ts',
];

const commandSpecs = [
  {
    name: 'typecheck',
    command: 'npm',
    args: ['run', 'typecheck'],
  },
  {
    name: 'focused-tests',
    command: 'npm',
    args: ['run', 'test:run', '--', ...focusedTests],
  },
  {
    name: 'vite-build',
    command: process.execPath,
    args: ['./node_modules/vite/bin/vite.js', 'build', '--config', 'vite.config.mjs'],
  },
];

function tail(value) {
  const text = typeof value === 'string' ? value : '';
  return text.length <= MAX_OUTPUT_CHARS ? text : text.slice(-MAX_OUTPUT_CHARS);
}

const startedAt = new Date().toISOString();
const results = commandSpecs.map((spec) => {
  const commandStartedAt = Date.now();
  const result = spawnSync(spec.command, spec.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    name: spec.name,
    command: [spec.command, ...spec.args].join(' '),
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    durationMs: Date.now() - commandStartedAt,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
  };
});

const report = {
  mode: 'focused',
  startedAt,
  finishedAt: new Date().toISOString(),
  commit: process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null,
  branch: process.env.CF_PAGES_BRANCH ?? null,
  passed: results.every((result) => result.exitCode === 0),
  results,
};

mkdirSync('dist', { recursive: true });
writeFileSync('dist/verification-report.json', `${JSON.stringify(report, null, 2)}\n`);

const buildResult = results.find((result) => result.name === 'vite-build');
if (buildResult?.exitCode !== 0) {
  writeFileSync(
    'dist/index.html',
    '<!doctype html><meta charset="utf-8"><title>Verification report</title><a href="/verification-report.json">verification-report.json</a>',
  );
}

console.log(JSON.stringify({ passed: report.passed, results: results.map(({ name, exitCode }) => ({ name, exitCode })) }));
process.exit(report.passed ? 0 : 1);
