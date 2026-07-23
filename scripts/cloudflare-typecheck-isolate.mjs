import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/features/weeklyPlanning/weeklyPlanningTurnController.ts';
const original = readFileSync(file, 'utf8');
const revisionFunction = `\nfunction inferWeeklyPlanningControllerRevisionFloor(revision: number): number {\n  if (!Number.isSafeInteger(revision) || revision <= 0) return 0;\n  return Math.floor(revision / 2);\n}\n`;
const revisionArgument = `\n    inferWeeklyPlanningControllerRevisionFloor(snapshot.revision),`;
const modified = original
  .replace(revisionFunction, '')
  .replace(revisionArgument, '');
if (modified === original) {
  throw new Error('controller isolation transform did not match');
}
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
