import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const tests = [
  'src/features/weeklyPlanning/weeklyPlanningTurnController.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceSessionStorage.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime.test.ts',
];
const result = spawnSync(
  process.execPath,
  ['./node_modules/vitest/vitest.mjs', '--config', 'vite.config.mjs', 'run', ...tests],
  { cwd: process.cwd(), encoding: 'utf8', env: process.env, stdio: 'inherit' },
);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', '<!doctype html><meta charset="utf-8"><title>focused tests group A</title>');
process.exit(result.status ?? 1);
