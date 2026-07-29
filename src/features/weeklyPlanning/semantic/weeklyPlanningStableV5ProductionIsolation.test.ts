import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEEKLY_PLANNING_ROOT = fileURLToPath(new URL('../', import.meta.url));
const STABLE_IMPORT_TOKENS = [
  'weeklyPlanningStableV5',
  'weeklyPlanningSemanticDocumentV5',
  'weeklyPlanningFactGraphV5',
  'weeklyPlanningSemanticNormalizerV5',
  'weeklyPlanningSemanticPipelineV5',
  'weeklyPlanningSemanticDialoguePipelineV5',
  'weeklyPlanningStableV5Persistence',
] as const;

const ALLOWED_PRODUCTION_IMPORTERS = new Set([
  'weeklyPlanningTurnExecutor.ts',
  'weeklyPlanningOwnedStorage.ts',
  'application/weeklyPlanningSessionLifecycle.ts',
  'application/weeklyPlanningStableV5InstrumentedRuntimeExecutor.ts',
  'application/weeklyPlanningStableV5RuntimeExecutor.ts',
  'application/weeklyPlanningStableV5RuntimeSession.ts',
  'application/weeklyPlanningStableV5SessionStorage.ts',
  'application/weeklyPlanningTurnApplication.ts',
  'application/weeklyPlanningTurnSideEffects.ts',
  'trace/weeklyPlanningStableV5TraceRuntime.ts',
  'trace/weeklyPlanningTraceOutbox.ts',
  'trace/weeklyPlanningTraceRemoteRepository.ts',
  'trace/weeklyPlanningTurnDiagnosticV2.ts',
]);

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (['.ts', '.tsx'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

function normalizedRelative(path: string): string {
  return relative(WEEKLY_PLANNING_ROOT, path).split(sep).join('/');
}

function isTestSource(relativePath: string): boolean {
  return relativePath.startsWith('__tests__/')
    || relativePath.includes('/__tests__/')
    || /\.(test|spec)\.(ts|tsx)$/.test(relativePath);
}

describe('Stable V5 production connection boundary', () => {
  it('allows Stable V5 imports only through audited runtime and trace support modules', () => {
    const violations: string[] = [];
    const connectedImporters = new Set<string>();
    for (const path of sourceFiles(WEEKLY_PLANNING_ROOT)) {
      const relativePath = normalizedRelative(path);
      if (isTestSource(relativePath)) continue;
      if (relativePath.startsWith('semantic/')) continue;
      const content = readFileSync(path, 'utf8');
      const usedTokens = STABLE_IMPORT_TOKENS.filter((token) => content.includes(token));
      if (usedTokens.length === 0) continue;
      if (ALLOWED_PRODUCTION_IMPORTERS.has(relativePath)) {
        connectedImporters.add(relativePath);
        continue;
      }
      usedTokens.forEach((token) => violations.push(`${relativePath}:${token}`));
    }

    expect(violations).toEqual([]);
    expect(connectedImporters).toEqual(ALLOWED_PRODUCTION_IMPORTERS);
  });
});
