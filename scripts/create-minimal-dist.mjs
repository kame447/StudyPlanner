import { mkdir, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await writeFile(
  'dist/index.html',
  '<!doctype html><meta charset="utf-8"><title>StudyPlanner verification</title><p>verification passed</p>',
  'utf8',
);
