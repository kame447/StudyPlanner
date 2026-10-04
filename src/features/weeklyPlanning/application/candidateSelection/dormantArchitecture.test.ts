import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const foundation = dirname(fileURLToPath(import.meta.url));
const repository = resolve(foundation, '../../../../..');
const isTest = (path: string) => /\.(test|spec|testUtils)\.[cm]?[jt]sx?$/.test(path);
const withinFoundation = (path: string) => path.startsWith(`${foundation}/`);
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.[cm]?[jt]sx?$/.test(path) ? [path] : [];
  });
}
const compilerOptions: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, allowJs: true };
function dependencies(file: string) {
  const source = readFileSync(file, 'utf8');
  return ts.preProcessFile(source, true, true).importedFiles.map((entry) => ({
    specifier: entry.fileName,
    resolved: ts.resolveModuleName(entry.fileName, file, compilerOptions, ts.sys).resolvedModule?.resolvedFileName,
  }));
}

describe('candidate selection stays a dormant application foundation', () => {
  it('has zero incoming runtime/UI/provider/scheduler/save/lifecycle/trace dependencies', () => {
    const incoming: string[] = [];
    for (const file of ['src', 'shared', 'workers'].flatMap((root) => files(join(repository, root)))) {
      if (isTest(file) || withinFoundation(file)) continue;
      for (const dependency of dependencies(file)) {
        if (dependency.resolved && withinFoundation(dependency.resolved)) incoming.push(`${relative(repository, file)} -> ${dependency.specifier}`);
      }
    }
    expect(incoming).toEqual([]);
  });

  it('imports only its own pure modules; owns no provider/storage/runtime adapter or telemetry writer', () => {
    const implementation = files(foundation).filter((file) => !isTest(file));
    expect(implementation.length).toBeGreaterThan(5);
    for (const file of implementation) {
      for (const dependency of dependencies(file)) {
        expect(dependency.resolved, `${file}: unresolved ${dependency.specifier}`).toBeDefined();
        expect(withinFoundation(dependency.resolved!), `${file} -> ${dependency.specifier}`).toBe(true);
      }
      const source = readFileSync(file, 'utf8');
      // Trace/request persistence deliberately excluded: no production request or diagnostic changes.
      for (const forbidden of ['fetch(', 'localStorage', 'indexedDB', 'firebase', 'commit_turn', 'JEV_MODE', 'JEV_CANARY_PERCENT', 'appendWeeklyPlanningTrace']) {
        expect(source, relative(repository, file)).not.toContain(forbidden);
      }
    }
  });
});
