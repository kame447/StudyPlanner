import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const foundation = dirname(fileURLToPath(import.meta.url));
const repository = resolve(foundation, '../../../../..');
const isTest = (path: string) => /\.(test|spec|testUtils)\.[cm]?[jt]sx?$/.test(path);
const withinFoundation = (path: string) => path.startsWith(`${foundation}/`);
// Explicit dormant numeric consumers; they must stay disconnected from every other production caller.
const numericConsumers = new Set(['src/features/weeklyPlanning/semantic/weeklyPlanningNumericPendingChoiceV5.ts', 'src/features/weeklyPlanning/semantic/weeklyPlanningNumericPendingCommitV5.ts']);
// Parent5000: each registered producer/importer is admitted individually; no folder wildcard.
const registeredNumericConsumers = new Set([
  // D5 producer: frozen finite domain feeds the existing numeric selector, not a normalizer shortcut.
  'src/features/weeklyPlanning/semantic/weeklyPlanningNumericPendingDomainV5.ts',
]);
// Every incoming file requires an intentional, individual review.
const allowedConsumers = new Set([
  // J2a calibrated production connection; test-only consumers stay excluded.
  'src/features/weeklyPlanning/application/weeklyPlanningCandidateChoiceConnection.ts',
  'src/features/weeklyPlanning/application/c5LocalSelection/contracts.ts',
  'src/features/weeklyPlanning/application/c5LocalSelection/basis.ts',
  'src/features/weeklyPlanning/application/c5LocalSelection/selection.ts',
  // J2c shared typed contracts, frozen codec, actual machine gates and native C5 registry.
  'src/features/weeklyPlanning/application/weeklyPlanningControlledCandidateDomains.ts',
  'src/features/weeklyPlanning/application/weeklyPlanningControlledCandidateQuestion.ts',
  'src/features/weeklyPlanning/application/weeklyPlanningControlledCandidateGates.ts',
  'src/features/weeklyPlanning/application/weeklyPlanningControlledCandidateRegistry.ts',
  // Shared continuation consumes producer formal contribution, never arbitrary graph differences.
  'src/features/weeklyPlanning/application/weeklyPlanningStableV5CandidateContinuation.ts',
  // D5: graph-derived lossless scope and frozen producer (explicit imports supplied by Sol1).
  'src/features/weeklyPlanning/semantic/weeklyPlanningNumericPendingScopeV5.ts',
  ...registeredNumericConsumers,
  // Date: reviewed fixed-clock/one-date producer and its existing formal correction bridge.
  'src/features/weeklyPlanning/semantic/weeklyPlanningTemporalDateChoiceV5.ts',
  'src/features/weeklyPlanning/semantic/weeklyPlanningTemporalDateCommitV5.ts',
  'src/features/weeklyPlanning/semantic/weeklyPlanningTemporalDateDomainV5.ts',
  ...numericConsumers,
]);
const testOnlyHelpers = new Set([
  resolve(repository, 'src/features/weeklyPlanning/application/c5LocalSelection/controller.testUtils.ts'),
  resolve(repository, 'src/features/weeklyPlanning/application/c5LocalSelection/evaluationHarness.testUtils.ts'),
]);
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

describe('candidate selection keeps the pure foundation and explicit consumer boundary', () => {
  it('allows only the individually reviewed consumer files to import the foundation', () => {
    const incoming: string[] = [];
    for (const file of ['src', 'shared', 'workers'].flatMap((root) => files(join(repository, root)))) {
      if (isTest(file) || withinFoundation(file)) continue;
      for (const dependency of dependencies(file)) {
        if (dependency.resolved && withinFoundation(dependency.resolved) && !allowedConsumers.has(relative(repository, file))) incoming.push(`${relative(repository, file)} -> ${dependency.specifier}`);
      }
    }
    expect(incoming).toEqual([]);
  });

  it('allows only the registered numeric producer to call the numeric domain modules', () => {
    const incoming: string[] = [];
    for (const file of ['src', 'shared', 'workers'].flatMap(root => files(join(repository, root)))) {
      if (isTest(file) || numericConsumers.has(relative(repository, file)) || registeredNumericConsumers.has(relative(repository, file))) continue;
      for (const dependency of dependencies(file)) {
        if (dependency.resolved && numericConsumers.has(relative(repository, dependency.resolved))) incoming.push(`${relative(repository, file)} -> ${dependency.specifier}`);
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

  it('keeps C5 controller fixtures and paired-evaluation helpers out of all production imports', () => {
    const incoming: string[] = [];
    for (const file of ['src', 'shared', 'workers'].flatMap((root) => files(join(repository, root)))) {
      if (isTest(file)) continue;
      for (const dependency of dependencies(file)) {
        if (dependency.resolved && testOnlyHelpers.has(dependency.resolved)) incoming.push(`${relative(repository, file)} -> ${dependency.specifier}`);
      }
    }
    expect(incoming).toEqual([]);
  });
});
