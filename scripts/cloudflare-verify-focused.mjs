import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const result = spawnSync('npm', ['run', 'typecheck'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: process.env,
  stdio: 'inherit',
});
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', '<!doctype html><meta charset="utf-8"><title>full typecheck</title>');
process.exit(result.status ?? 1);
