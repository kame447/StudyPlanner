import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const vnextRoot = 'src/features/weeklyPlanning/vnext/';
const testSupport = /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)evals\/vnext[^/]*$/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe('VNext isolation (Issue #926)', () => {
  it('is not imported by any production module outside vnext/, so Stable V5 stays the only runtime', () => {
    const importers = sourceFiles(join(repository, 'src'))
      .map((path) => relative(repository, path).split(sep).join('/'))
      .filter((path) => !path.startsWith(vnextRoot) && !testSupport.test(path))
      .filter((path) => /from\s+['"][^'"]*\/vnext\//.test(readFileSync(join(repository, path), 'utf8')));
    expect(importers).toEqual([]);
  });
});
