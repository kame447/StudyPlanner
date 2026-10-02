import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.ReactJSX,
};

function runtimeModuleGraph(entry: string): Set<string> {
  const visited = new Set<string>();

  function visit(path: string): void {
    if (visited.has(path)) return;
    visited.add(path);
    if (path.endsWith('.json')) return;

    // Inspect emitted imports so type-only references cannot become runtime edges.
    // preProcessFile also includes re-exports and literal dynamic imports.
    const emitted = ts.transpileModule(readFileSync(path, 'utf8'), {
      fileName: path,
      compilerOptions,
    }).outputText;
    for (const imported of ts.preProcessFile(emitted, true, true).importedFiles) {
      if (!imported.fileName.startsWith('.')) continue;
      const base = resolve(dirname(path), imported.fileName);
      const resolved = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
        .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
      if (!resolved) {
        throw new Error(`Unresolved module ${imported.fileName} from ${dirname(path)}`);
      }
      visit(resolved);
    }
  }

  visit(entry);
  return new Set([...visited].map((path) => relative(sourceRoot, path).split('\\').join('/')));
}

describe('weekly planning approval application architecture', () => {
  it('keeps the entire approval runtime graph independent of legacy draft transforms and parsing', () => {
    const graph = runtimeModuleGraph(fileURLToPath(
      new URL('./weeklyPlanningApprovalApplication.ts', import.meta.url),
    ));

    expect(graph).not.toContain('features/weeklyPlanning/weeklyPlanningTransforms.ts');
    expect(graph).not.toContain('services/naturalLanguageRules.ts');
    expect(graph).toContain('features/weeklyPlanning/application/weeklyPlanningDraftConversion.ts');
  });
});
