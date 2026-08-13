import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LEGACY_TOKEN = 'weeklyPlanningBehaviorAware';

const REQUIRED_LEGACY_ROOTS = new Set([
  'features/weeklyPlanning/planning/weeklyPlanningBehaviorAwarePreviewBridge.ts',
  'features/weeklyPlanning/planning/weeklyPlanningBehaviorAwarePreviewBridgeHardened.ts',
  'features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline.ts',
]);

const EXPECTED_TYPE_ONLY_EDGES = new Set([
  'features/weeklyPlanning/pipeline/weeklyPlanningRenderedQuestionContext.ts:./weeklyPlanningBehaviorAwareIntakePipeline',
  'features/weeklyPlanning/trace/weeklyPlanningTraceRuntime.ts:../pipeline/weeklyPlanningBehaviorAwareIntakePipeline',
]);

interface ImportedSpecifier {
  specifier: string;
  typeOnly: boolean;
}

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
  return relative(SRC_ROOT, path).split(sep).join('/');
}

function isTestSource(relativePath: string): boolean {
  return relativePath.startsWith('__tests__/')
    || relativePath.includes('/__tests__/')
    || /\.(test|spec)\.(ts|tsx)$/.test(relativePath);
}

function importDeclarationIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function exportDeclarationIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return false;
  return node.exportClause.elements.length > 0
    && node.exportClause.elements.every((element) => element.isTypeOnly);
}

function importedSpecifiers(path: string): ImportedSpecifier[] {
  const source = readFileSync(path, 'utf8');
  const parsed = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(path) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: ImportedSpecifier[] = [];

  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push({
        specifier: statement.moduleSpecifier.text,
        typeOnly: importDeclarationIsTypeOnly(statement),
      });
      continue;
    }
    if (
      ts.isExportDeclaration(statement)
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push({
        specifier: statement.moduleSpecifier.text,
        typeOnly: exportDeclarationIsTypeOnly(statement),
      });
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({
        specifier: node.arguments[0].text,
        typeOnly: false,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);

  return imports;
}

function resolveRelativeModule(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function targetsLegacyCluster(
  importer: string,
  specifier: string,
  legacySources: ReadonlySet<string>,
): boolean {
  if (specifier.includes(LEGACY_TOKEN)) return true;
  const resolved = resolveRelativeModule(importer, specifier);
  return Boolean(resolved && legacySources.has(resolved));
}

describe('legacy behavior-aware production isolation', () => {
  it('has no runtime import edge from outside the isolated behavior-aware cluster', () => {
    const allSources = sourceFiles(SRC_ROOT);
    const productionSources = allSources.filter(
      (path) => !isTestSource(normalizedRelative(path)),
    );
    const legacySources = new Set(
      productionSources.filter((path) => normalizedRelative(path).includes(LEGACY_TOKEN)),
    );
    const discoveredLegacyRoots = new Set(
      [...legacySources].map(normalizedRelative),
    );

    for (const requiredRoot of REQUIRED_LEGACY_ROOTS) {
      expect(discoveredLegacyRoots.has(requiredRoot)).toBe(true);
    }

    const runtimeEdges: string[] = [];
    const typeOnlyEdges: string[] = [];
    for (const importer of productionSources) {
      if (legacySources.has(importer)) continue;
      const importerRelative = normalizedRelative(importer);
      for (const imported of importedSpecifiers(importer)) {
        if (!targetsLegacyCluster(importer, imported.specifier, legacySources)) continue;
        const edge = `${importerRelative}:${imported.specifier}`;
        if (imported.typeOnly) typeOnlyEdges.push(edge);
        else runtimeEdges.push(edge);
      }
    }

    expect(runtimeEdges).toEqual([]);
    expect(new Set(typeOnlyEdges)).toEqual(EXPECTED_TYPE_ONLY_EDGES);
  });
});
