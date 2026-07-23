import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/features/weeklyPlanning/weeklyPlanningTurnController.ts';
const original = readFileSync(file, 'utf8');
const helperStart = original.indexOf(
  'export function inferWeeklyPlanningControllerRequestSequence(',
);
const helperEnd = original.indexOf(
  '\nfunction inferWeeklyPlanningControllerRevisionFloor',
  helperStart,
);
if (helperStart < 0 || helperEnd < 0) {
  throw new Error('controller helper isolation boundaries were not found');
}
const replacement = `export function inferWeeklyPlanningControllerRequestSequence(\n  _messages: readonly WeeklyPlanningMessage[],\n  _conversationId: string,\n): number {\n  return 0;\n}\n`;
const modified = `${original.slice(0, helperStart)}${replacement}${original.slice(helperEnd + 1)}`;
writeFileSync(file, modified);

let typecheck;
try {
  typecheck = spawnSync('npm', ['run', 'typecheck:build'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: 'inherit',
  });
} finally {
  writeFileSync(file, original);
}

if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);

const build = spawnSync(
  process.execPath,
  ['./node_modules/vite/bin/vite.js', 'build', '--config', 'vite.config.mjs'],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: 'inherit',
  },
);
process.exit(build.status ?? 1);
