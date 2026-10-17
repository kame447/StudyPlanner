import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const weekly = 'src/features/weeklyPlanning/';
const semantic = `${weekly}semantic/`;
const dialogue = `${weekly}dialogue/`;
const script = /\.[cm]?[jt]sx?$/;
const testSupport = /\.(?:test|spec|testUtils)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|testUtils|testFixtures|evals)\//;
const asset = /\.(?:css|svg|png|jpe?g|gif|webp|mp4|woff2?)(?:\?.*)?$/;
const portable = (path: string) => path.split(sep).join('/');

// Reviewed construction/transport modules, not a provider-name filename heuristic.
// PROJECT_MAP.md:133–147 separates integration/persistence from domain callers.
const providerImplementations = new Set([
  'src/services/ai/openAiCompatibleClient.ts',
  'src/services/ai/candidateChoiceClient.ts',
  'src/lib/firebaseClient.ts',
]);
// Dialogue architecture v5:30–40 assigns approval/save to application, not rendering.
// Feature-owned storage is just as authoritative as the general repositories.
const planningPersistence = new Set([
  `${weekly}weeklyPlanningStorage.ts`,
  `${weekly}weeklyPlanningOwnedStorage.ts`,
  `${weekly}weeklyPlanningStorageRetention.ts`,
  `${weekly}chat/aiPlanningChatStore.ts`,
  `${weekly}application/weeklyPlanningStableV5SessionStorage.ts`,
  `${weekly}application/weeklyPlanningApprovalLedgerStorage.ts`,
  `${weekly}application/weeklyPlanningApprovalApplication.ts`,
  `${weekly}application/weeklyPlanningApprovalPlanRepository.ts`,
  `${weekly}application/weeklyPlanningApprovalFirestoreRepository.ts`,
  `${weekly}application/weeklyPlanningApprovalLocalRepository.ts`,
  `${weekly}application/weeklyPlanningApprovalMemoryRepository.ts`,
]);

type Rule = 'semantic-provider' | 'semantic-dialogue-persistence' | 'legacy-parser';
interface Edge { from: string; line: number; specifier: string | null; to: string | null }
interface Violation { entry: string; rule: Rule; path: Edge[] }

function runtimeImports(file: string, text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports: { specifier: string | null; line: number }[] = [];
  const allTypes = (bindings: ts.NamedImportBindings | undefined) =>
    bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0
      && bindings.elements.every(element => element.isTypeOnly);
  function add(node: ts.Node, value: ts.Node | undefined) {
    imports.push({
      specifier: value && ts.isStringLiteralLike(value) ? value.text : null,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    });
  }
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (!clause || !(clause.isTypeOnly || (!clause.name && allTypes(clause.namedBindings)))) {
        add(node, node.moduleSpecifier);
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const names = node.exportClause;
      if (!(node.isTypeOnly || (names && ts.isNamedExports(names) && names.elements.length > 0
        && names.elements.every(element => element.isTypeOnly)))) add(node, node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (!node.isTypeOnly) add(node, node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      add(node, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? productionFiles(file)
      : script.test(file) && !file.endsWith('.d.ts') && !testSupport.test(portable(file)) ? [file] : [];
  });
}

// Resolve once per module; traverse through barrels/helpers outside protected folders too.
// The same checker runs against real sources and isolated in-memory fixture sources.
function checkDirections(root: string, entries: string[], options: ts.CompilerOptions, host: ts.ModuleResolutionHost) {
  const cache = ts.createModuleResolutionCache(root, value => value, options);
  const modules = new Map<string, (Edge & { resolved?: ts.ResolvedModuleFull })[]>();
  const incomplete = new Set<string>();
  const violations: Violation[] = [];
  function dependencies(file: string) {
    let edges = modules.get(file);
    if (!edges) {
      const source = host.readFile?.(file);
      if (source === undefined) throw new Error(`Cannot inspect ${file}`);
      edges = runtimeImports(file, source).map(imported => {
        const resolved = imported.specifier === null ? undefined
          : ts.resolveModuleName(imported.specifier, file, options, host, cache).resolvedModule;
        const edge = { ...imported, from: portable(relative(root, file)),
          to: resolved ? portable(relative(root, resolved.resolvedFileName)) : null, resolved };
        if (!resolved && !(imported.specifier && asset.test(imported.specifier))) {
          incomplete.add(`${edge.from}:${edge.line} -> ${edge.specifier ?? '<computed import>'}`);
        }
        return edge;
      });
      modules.set(file, edges);
    }
    return edges;
  }
  for (const entry of entries) {
    const entryPath = portable(relative(root, entry));
    const seen = new Set<string>();
    const queue = [{ file: entry, path: [] as Edge[] }];
    for (let index = 0; index < queue.length; index++) {
      const item = queue[index];
      if (seen.has(item.file)) continue;
      seen.add(item.file);
      for (const edge of dependencies(item.file)) {
        if (!edge.resolved || !edge.to) continue;
        const path = [...item.path, { from: edge.from, line: edge.line, specifier: edge.specifier, to: edge.to }];
        const rules: Rule[] = [];
        if (entryPath.startsWith(semantic) && (providerImplementations.has(edge.to)
          || /(?:^|\/)node_modules\/(?:firebase|@firebase)\//.test(edge.to))) rules.push('semantic-provider');
        if ((entryPath.startsWith(semantic) || entryPath.startsWith(dialogue))
          && (edge.to.startsWith('src/repositories/') || planningPersistence.has(edge.to))) {
          rules.push('semantic-dialogue-persistence');
        }
        // PROJECT_MAP.md:147; current-contract-v5.md:32,42,52 forbid legacy fallback.
        if (edge.to.startsWith('src/services/natural-language/') || edge.to === 'src/services/naturalLanguagePlanner.ts') {
          rules.push('legacy-parser');
        }
        for (const rule of rules) violations.push({ entry: entryPath, rule, path });
        if (!edge.resolved.isExternalLibraryImport && !edge.to.includes('node_modules/')
          && script.test(edge.to) && !edge.to.endsWith('.d.ts')) {
          queue.push({ file: edge.resolved.resolvedFileName, path });
        }
      }
    }
  }
  return { violations, incomplete: [...incomplete], inspectedModules: modules.size };
}

const fixtureSemantic = `${semantic}model.ts`;
const fixtureDialogue = `${dialogue}renderer.ts`;
function fixture(source: string, entry = fixtureSemantic, extra: Record<string, string> = {}) {
  const sources = new Map(Object.entries({
    [entry]: source,
    'src/repositories/backend.ts': 'export interface Contract {} export const persist = () => {};',
    'src/services/ai/openAiCompatibleClient.ts': 'export const createClient = () => {};',
    'src/services/ai/openAiCompatibleClientTypes.ts': 'export interface Client {}',
    'src/services/natural-language/normalize.ts': 'export const normalize = () => {};',
    'src/types/domain.ts': 'export interface Plan {}',
    [`${weekly}application/weeklyPlanningStableV5SessionStorage.ts`]: 'export const save = () => {};',
    ...extra,
  }).map(([file, text]) => [resolve(repository, file), text]));
  const directories = new Set<string>();
  for (const file of sources.keys()) {
    for (let directory = dirname(file); !directories.has(directory); directory = dirname(directory)) {
      directories.add(directory);
      if (dirname(directory) === directory) break;
    }
  }
  const host: ts.ModuleResolutionHost = {
    fileExists: file => sources.has(file), readFile: file => sources.get(file),
    directoryExists: directory => directories.has(directory), getCurrentDirectory: () => repository,
  };
  const options: ts.CompilerOptions = { module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, baseUrl: repository, paths: { '@fixture/*': ['src/*'] } };
  return checkDirections(repository, [resolve(repository, entry)], options, host);
}

function assertDirections(result: ReturnType<typeof checkDirections>) {
  expect(result.incomplete, 'Every reachable runtime import must be inspectable').toEqual([]);
  expect(result.violations, 'Dependency direction violations (entry and full import path)').toEqual([]);
}

describe('weekly planning module dependency directions', () => {
  it('holds on the resolved production graph without exceptions', () => {
    const config = ts.readConfigFile(join(repository, 'tsconfig.json'), ts.sys.readFile);
    expect(config.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repository);
    expect(parsed.errors).toEqual([]);
    const entries = productionFiles(join(repository, weekly));
    expect(entries.filter(file => portable(file).includes('/semantic/')).length).toBeGreaterThan(100);
    expect(entries.filter(file => portable(file).includes('/dialogue/')).length).toBeGreaterThan(10);
    const result = checkDirections(repository, entries, parsed.options, ts.sys);
    expect(result.inspectedModules).toBeGreaterThan(entries.length);
    assertDirections(result);
  });

  it.each([
    "import { persist } from '@fixture/repositories/backend';",
    "import { type Contract, persist } from '@fixture/repositories/backend';",
    "import '@fixture/repositories/backend';",
    "export * from '@fixture/repositories/backend';",
    "export * as backend from '@fixture/repositories/backend';",
    "const backend = import('@fixture/repositories/backend');",
    "const backend = require('@fixture/repositories/backend');",
    "import Backend = require('@fixture/repositories/backend');",
  ])('rejects a persistence fixture with runtime syntax: %s', source => {
    const result = fixture(source, fixtureDialogue);
    expect(result.incomplete).toEqual([]);
    expect(result.violations).toEqual([{ entry: fixtureDialogue, rule: 'semantic-dialogue-persistence',
      path: [{ from: fixtureDialogue, line: 1, specifier: '@fixture/repositories/backend', to: 'src/repositories/backend.ts' }] }]);
    expect(() => assertDirections(result)).toThrow();
  });

  it('follows a barrel and cycle outside the protected directories', () => {
    const result = fixture("export * from '../../../../shared/barrel';", fixtureSemantic, {
      'shared/barrel.ts': "export * from './cycle';",
      'shared/cycle.ts': "export * from './barrel'; export { persist } from '../src/repositories/backend';",
    });
    expect(result.incomplete).toEqual([]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].path.map(edge => edge.to)).toEqual([
      'shared/barrel.ts', 'shared/cycle.ts', 'src/repositories/backend.ts',
    ]);
  });

  it.each([...providerImplementations])('keeps semantic processing independent of %s', implementation => {
    const result = fixture(`import '@fixture/${implementation.slice('src/'.length, -3)}';`, fixtureSemantic, {
      [implementation]: 'export const implementation = 1;',
    });
    expect(result.incomplete).toEqual([]);
    expect(result.violations.map(hit => hit.rule)).toEqual(['semantic-provider']);
    expect(() => assertDirections(result)).toThrow();
  });

  it.each([...planningPersistence])('protects the reviewed feature persistence implementation %s', implementation => {
    const result = fixture(`import '@fixture/${implementation.slice('src/'.length, -3)}';`, fixtureDialogue, {
      [implementation]: 'export const implementation = 1;',
    });
    expect(result.incomplete).toEqual([]);
    expect(result.violations.map(hit => hit.rule)).toEqual(['semantic-dialogue-persistence']);
  });

  it.each(['firebase/app', '@firebase/app'])('rejects a direct semantic SDK dependency: %s', sdk => {
    const result = fixture(`import '${sdk}';`, fixtureSemantic, {
      [`node_modules/${sdk}.d.ts`]: 'export declare const initializeApp: unknown;',
    });
    expect(result.incomplete).toEqual([]);
    expect(result.violations.map(hit => hit.rule)).toEqual(['semantic-provider']);
  });

  it.each(['src/services/natural-language/normalize.ts', 'src/services/naturalLanguagePlanner.ts'])(
    'rejects the separate legacy parser from scheduling, including through a helper: %s', implementation => {
      const result = fixture("export * from '../../../../shared/helper';", `${weekly}scheduling/placement.ts`, {
        'shared/helper.ts': `export * from '../${implementation.slice(0, -3)}';`,
        [implementation]: 'export const normalize = () => {};',
      });
      expect(result.incomplete).toEqual([]);
      expect(result.violations.map(hit => hit.rule)).toEqual(['legacy-parser']);
      expect(() => assertDirections(result)).toThrow();
    },
  );

  it('allows typed contracts/domain values without treating comments or strings as dependencies', () => {
    assertDirections(fixture(`
      import type { Contract } from '@fixture/repositories/backend';
      import { type Client } from '@fixture/services/ai/openAiCompatibleClientTypes';
      export type { Contract } from '@fixture/repositories/backend';
      export { type Client } from '@fixture/services/ai/openAiCompatibleClientTypes';
      type Plan = import('@fixture/types/domain').Plan;
      export const value = 1;
      // import '@fixture/repositories/backend';
      const text = "import('@fixture/repositories/backend')";
    `));
  });

  it('allows provider construction in the dialogue adapter and persistence in application', () => {
    assertDirections(fixture("import '@fixture/services/ai/openAiCompatibleClient';", fixtureDialogue));
    assertDirections(fixture("import '@fixture/repositories/backend';", `${weekly}application/save.ts`));
  });

  it('does not hide a reachable production dependency behind a test-named helper', () => {
    const result = fixture("export * from './helper.testUtils';", fixtureSemantic, {
      [`${semantic}helper.testUtils.ts`]: "export * from '@fixture/repositories/backend';",
    });
    expect(result.incomplete).toEqual([]);
    expect(result.violations.map(hit => hit.rule)).toEqual(['semantic-dialogue-persistence']);
  });

  it.each(["const name = './backend'; import(name);", "export * from './missing';"])(
    'fails when the runtime graph cannot be inspected: %s', source => {
      const result = fixture(source);
      expect(result.incomplete).toHaveLength(1);
      expect(() => assertDirections(result)).toThrow();
    },
  );
});
