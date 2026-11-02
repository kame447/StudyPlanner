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
  it('has exactly one external composition entry, whose compile-time comparison flag keeps production hosts on VNext', () => {
    const importers = sourceFiles(join(repository, 'src'))
      .map((path) => relative(repository, path).split(sep).join('/'))
      .filter((path) => !path.startsWith(vnextRoot) && !testSupport.test(path))
      .filter((path) => /from\s+['"][^'"]*\/vnext\//.test(readFileSync(join(repository, path), 'utf8')));
    expect(importers).toEqual(['src/features/weeklyPlanning/application/useWeeklyPlanningConversationApplication.ts']);
    const entry = readFileSync(join(repository, importers[0]), 'utf8');
    expect(entry).toContain("import.meta.env.VITE_WEEKLY_PLANNING_CORE === 'stable_v5'");
    expect(entry).not.toContain('VITE_ENABLE_WEEKLY_PLANNING_VNEXT');
    expect(entry).not.toContain('window.location.search');
    expect(entry).not.toContain('import.meta.env.DEV');
    expect(entry).not.toContain('import.meta.env.PROD');
    expect(entry).toContain('resolveWeeklyPlanningConversationCore(');
    // Executable local/production controls live in LocalRuntime.integration; this test
    // prevents a second direct entry from bypassing that one gate.
  });
});
