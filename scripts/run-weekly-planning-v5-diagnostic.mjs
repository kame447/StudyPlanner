import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

function run(label, command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  return [
    `## ${label}`,
    `exitCode=${result.status ?? 'null'}`,
    '',
    result.stdout || '',
    result.stderr || '',
  ].join('\n');
}

const sections = [
  run(
    'semantic tests',
    process.execPath,
    [
      './node_modules/vitest/vitest.mjs',
      '--config',
      'vite.config.mjs',
      'run',
      'src/features/weeklyPlanning/semantic',
      'workers/ai-proxy/src/modelPolicy.test.ts',
    ],
  ),
  run(
    'typescript',
    process.execPath,
    ['./node_modules/typescript/bin/tsc', '--noEmit'],
  ),
];

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await writeFile(
  'dist/weekly-planning-v5-diagnostic.txt',
  `${sections.join('\n\n')}\n`,
  'utf8',
);
await writeFile(
  'dist/index.html',
  '<!doctype html><meta charset="utf-8"><title>V5 diagnostic</title><a href="/weekly-planning-v5-diagnostic.txt">diagnostic</a>',
  'utf8',
);
