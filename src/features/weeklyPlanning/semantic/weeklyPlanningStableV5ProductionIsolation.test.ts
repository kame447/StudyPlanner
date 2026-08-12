import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEEKLY_PLANNING_ROOT = fileURLToPath(new URL('../', import.meta.url));
const STABLE_MODULE_TOKENS = [
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
  'weeklyPlanningTurnExecutionTypes.ts',
  'weeklyPlanningOwnedStorage.ts',
  'application/weeklyPlanningApprovalApplication.ts',
  'application/weeklyPlanningApprovalAvailability.ts',
  'application/weeklyPlanningSessionLifecycle.ts',
  'application/weeklyPlanningStableV5GraphStaging.ts',
  'application/weeklyPlanningStableV5InstrumentedRuntimeExecutor.ts',
  'application/weeklyPlanningStableV5RuntimeExecutor.ts',
  'application/weeklyPlanningStableV5RuntimeQuestions.ts',
  'application/weeklyPlanningStableV5RuntimeSession.ts',
  'application/weeklyPlanningStableV5SemanticContext.ts',
  'application/weeklyPlanningStableV5SemanticTurn.ts',
  'application/weeklyPlanningStableV5SessionCodec.ts',
  'application/weeklyPlanningStableV5SessionStorage.ts',
  'application/weeklyPlanningTurnApplication.ts',
  'application/weeklyPlanningTurnSideEffects.ts',
  'application/weeklyPlanningTurnTraceSideEffects.ts',
  'dialogue/weeklyPlanningStableV5AiDialogueRenderer.ts',
  'dialogue/weeklyPlanningStableV5DialoguePrompt.ts',
  'dialogue/weeklyPlanningStableV5DialogueRouting.ts',
  'dialogue/weeklyPlanningStableV5DialogueValidation.ts',
  'dialogue/weeklyPlanningStableV5TurnDialogue.ts',
  'dialogue/weeklyPlanningStableV5TurnDialogueTrace.ts',
  'trace/weeklyPlanningStableV5TraceRuntime.ts',
  'trace/weeklyPlanningTraceOutbox.ts',
  'trace/weeklyPlanningTraceRemoteRepository.ts',
  'trace/weeklyPlanningTurnDiagnosticV2.ts',
]);

const STATIC_IMPORT_EXPRESSION = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;

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

function importedStableModules(source: string): string[] {
  return [...source.matchAll(STATIC_IMPORT_EXPRESSION)]
    .map((match) => match[1])
    .filter((specifier) => STABLE_MODULE_TOKENS.some((token) => specifier.includes(token)));
}

describe('Stable V5 production connection boundary', () => {
  it('allows direct Stable V5 imports only through explicitly audited runtime support modules', () => {
    const violations: string[] = [];
    const connectedImporters = new Set<string>();
    for (const path of sourceFiles(WEEKLY_PLANNING_ROOT)) {
      const relativePath = normalizedRelative(path);
      if (isTestSource(relativePath)) continue;
      if (relativePath.startsWith('semantic/')) continue;

      const imports = importedStableModules(readFileSync(path, 'utf8'));
      if (imports.length === 0) continue;
      if (ALLOWED_PRODUCTION_IMPORTERS.has(relativePath)) {
        connectedImporters.add(relativePath);
        continue;
      }
      imports.forEach((specifier) => violations.push(`${relativePath}:${specifier}`));
    }

    expect(violations).toEqual([]);
    expect(connectedImporters).toEqual(ALLOWED_PRODUCTION_IMPORTERS);
  });
});
