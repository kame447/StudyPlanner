import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const commands = [
  { name: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
  { name: 'typecheck:build', command: 'npm', args: ['run', 'typecheck:build'] },
  { name: 'test:run', command: 'npm', args: ['run', 'test:run'] },
  {
    name: 'vite build',
    command: 'node',
    args: ['./node_modules/vite/bin/vite.js', 'build', '--config', 'vite.config.mjs'],
  },
];

function tail(value, maximum = 40_000) {
  const text = typeof value === 'string' ? value : '';
  return text.length <= maximum ? text : text.slice(-maximum);
}

const results = commands.map(({ name, command, args }) => {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    name,
    startedAt,
    endedAt: new Date().toISOString(),
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
  };
});

mkdirSync('dist', { recursive: true });
writeFileSync('dist/verification.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  node: process.version,
  allPassed: results.every((result) => result.status === 0),
  results,
}, null, 2));

console.log('Pages verification diagnostics written to dist/verification.json');
