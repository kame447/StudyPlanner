import { spawnSync } from 'node:child_process';

const tests = [
  'src/features/weeklyPlanning/weeklyPlanningTurnController.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceSessionStorage.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningTraceRemoteRepository.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRemoteContinuity.integration.test.ts',
  'src/features/weeklyPlanning/__tests__/weeklyPlanningStableV5ConversationTrace.integration.test.ts',
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npm', ['run', 'typecheck']);
run(process.execPath, [
  './node_modules/vitest/vitest.mjs',
  '--config',
  'vite.config.mjs',
  'run',
  ...tests,
]);
run(process.execPath, [
  './node_modules/vite/bin/vite.js',
  'build',
  '--config',
  'vite.config.mjs',
]);
