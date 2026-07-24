import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const tests = [
  'src/features/weeklyPlanning/trace/weeklyPlanningTraceRemoteRepository.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRemoteContinuity.integration.test.ts',
  'src/features/weeklyPlanning/__tests__/weeklyPlanningStableV5ConversationTrace.integration.test.ts',
];
const result = spawnSync(
  process.execPath,
  ['./node_modules/vitest/vitest.mjs', '--config', 'vite.config.mjs', 'run', ...tests],
  { cwd: process.cwd(), encoding: 'utf8', env: process.env, stdio: 'inherit' },
);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', '<!doctype html><meta charset="utf-8"><title>remote and integration tests</title>');
process.exit(result.status ?? 1);
