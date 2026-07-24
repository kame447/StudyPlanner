import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/features/weeklyPlanning/weeklyPlanningTurnController.ts';
const original = readFileSync(file, 'utf8');
const base = spawnSync(
  'git',
  ['show', 'a669b166db30fa3f355371c089062eb5cf4e3987:src/features/weeklyPlanning/weeklyPlanningTurnController.ts'],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  },
);
if (base.status !== 0 || !base.stdout) {
  throw new Error(base.stderr || 'could not read the main controller');
}
writeFileSync(file, base.stdout);

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
