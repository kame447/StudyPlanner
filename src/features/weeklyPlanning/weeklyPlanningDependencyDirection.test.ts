import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const config = ts.readConfigFile(join(repository, 'tsconfig.json'), ts.sys.readFile);
const compilerConfig = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, repository);
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

function runtimeImports(file: string, text: string, options: ts.CompilerOptions, inspectElision = true, onEmit?: () => void) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports: { specifier: string | null; line: number }[] = [];
  const referencedNames = new Set<string>();
  function collectNames(node: ts.Node) {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node)) referencedNames.add(node.text);
    ts.forEachChild(node, collectNames);
  }
  if (inspectElision) collectNames(source);
  let emittedModules: Set<string> | undefined;
  function survivesEmit(specifier: ts.Expression) {
    if (!ts.isStringLiteralLike(specifier)) return true;
    if (!emittedModules) {
      // Delegate type-position/elision decisions to the configured compiler, not
      // a second type-syntax classifier. Keep source nodes for diagnostic lines.
      onEmit?.();
      const emitted = ts.transpileModule(text, { fileName: file, compilerOptions: options }).outputText;
      emittedModules = new Set(ts.preProcessFile(emitted, true, true).importedFiles.map(entry => entry.fileName));
    }
    return emittedModules.has(specifier.text);
  }
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
      if (!clause) add(node, node.moduleSpecifier);
      else if (!clause.isTypeOnly) {
        const bindings = clause.namedBindings;
        const names = [clause.name, ...(bindings
          ? ts.isNamespaceImport(bindings) ? [bindings.name] : bindings.elements.map(element => element.name)
          : [])].filter((name): name is ts.Identifier => name !== undefined);
        const explicitTypes = !clause.name && allTypes(bindings);
        // An entirely unused declaration supplies no type-use evidence; retain
        // it conservatively (noUnusedLocals separately rejects unused bindings).
        if (!inspectElision) {
          if (!explicitTypes || options.verbatimModuleSyntax) add(node, node.moduleSpecifier);
        } else if ((!explicitTypes && options.noUnusedLocals && names.length > 0
          && !names.some(name => referencedNames.has(name.text)))
          || survivesEmit(node.moduleSpecifier)) add(node, node.moduleSpecifier);
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const names = node.exportClause;
      const explicitTypes = names && ts.isNamedExports(names) && names.elements.length > 0
        && names.elements.every(element => element.isTypeOnly);
      if (!node.isTypeOnly && (!explicitTypes || (inspectElision
        ? survivesEmit(node.moduleSpecifier) : options.verbatimModuleSyntax))) add(node, node.moduleSpecifier);
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
  const emitOptions: ts.CompilerOptions = { ...options, noEmit: false, declaration: false,
    emitDeclarationOnly: false, sourceMap: false, inlineSourceMap: false };
  type ResolvedEdge = Edge & { resolved?: ts.ResolvedModuleFull };
  const modules = new Map<string, { source: string; raw: ResolvedEdge[]; exact?: ResolvedEdge[] }>();
  const rules: Rule[] = ['semantic-provider', 'semantic-dialogue-persistence', 'legacy-parser'];
  const candidatePaths = new Map(rules.map(rule => [rule, new Set<string>()]));
  const inspectionCandidates = new Set<string>();
  const reverse = new Map<string, Set<string>>();
  let compilerEmits = 0;
  const noteEmit = () => { compilerEmits++; };
  const incomplete = new Set<string>();
  const violations: Violation[] = [];
  function matchesTarget(rule: Rule, to: string) {
    if (rule === 'semantic-provider') return providerImplementations.has(to)
      || /(?:^|\/)node_modules\/(?:firebase|@firebase)\//.test(to);
    if (rule === 'semantic-dialogue-persistence') return to.startsWith('src/repositories/') || planningPersistence.has(to);
    // PROJECT_MAP.md:147; current-contract-v5.md:32,42,52 forbid legacy fallback.
    return to.startsWith('src/services/natural-language/') || to === 'src/services/naturalLanguagePlanner.ts';
  }
  const localScript = (edge: ResolvedEdge) => edge.resolved && !edge.resolved.isExternalLibraryImport
    && edge.to && !edge.to.includes('node_modules/') && script.test(edge.to) && !edge.to.endsWith('.d.ts');
  const uninspectable = (edge: ResolvedEdge) => !edge.resolved && !(edge.specifier && asset.test(edge.specifier));
  function resolveImports(file: string, imports: ReturnType<typeof runtimeImports>): ResolvedEdge[] {
    return imports.map(imported => {
      const resolved = imported.specifier === null ? undefined
        : ts.resolveModuleName(imported.specifier, file, options, host, cache).resolvedModule;
      return { ...imported, from: portable(relative(root, file)),
        to: resolved ? portable(relative(root, resolved.resolvedFileName)) : null, resolved };
    });
  }
  function dependencies(file: string, relevant?: Rule[]) {
    let module = modules.get(file);
    if (!module) {
      const source = host.readFile?.(file);
      if (source === undefined) throw new Error(`Cannot inspect ${file}`);
      module = { source, raw: resolveImports(file, runtimeImports(file, source, emitOptions, false)) };
      modules.set(file, module);
    }
    if (relevant && !module.exact && (inspectionCandidates.has(portable(relative(root, file)))
      || module.raw.some(edge => edge.to && relevant.some(rule => candidatePaths.get(rule)!.has(edge.to!))))) {
      module.exact = resolveImports(file, runtimeImports(file, module.source, emitOptions, true, noteEmit));
    }
    return module.exact ?? module.raw;
  }

  // Cheap syntactic superset first. Propagate forbidden destinations backwards,
  // so type-only imports through otherwise allowed barrels also get an emit verdict.
  const pending = [...new Set(entries)];
  const discovered = new Set(pending);
  for (let index = 0; index < pending.length; index++) {
    for (const edge of dependencies(pending[index])) {
      if (uninspectable(edge)) inspectionCandidates.add(edge.from);
      if (!edge.to) continue;
      if (!reverse.has(edge.to)) reverse.set(edge.to, new Set());
      reverse.get(edge.to)!.add(edge.from);
      for (const rule of rules) if (matchesTarget(rule, edge.to)) candidatePaths.get(rule)!.add(edge.to);
      if (localScript(edge) && !discovered.has(edge.resolved!.resolvedFileName)) {
        discovered.add(edge.resolved!.resolvedFileName);
        pending.push(edge.resolved!.resolvedFileName);
      }
    }
  }
  for (const candidates of [...candidatePaths.values(), inspectionCandidates]) {
    const queue = [...candidates];
    for (let index = 0; index < queue.length; index++) {
      for (const from of reverse.get(queue[index]) ?? []) {
        if (!candidates.has(from)) { candidates.add(from); queue.push(from); }
      }
    }
  }

  for (const entry of entries) {
    const entryPath = portable(relative(root, entry));
    const relevant = rules.filter(rule => rule === 'legacy-parser' || entryPath.startsWith(semantic)
      || (rule === 'semantic-dialogue-persistence' && entryPath.startsWith(dialogue)));
    // Every source is already scanned. An emitted subset cannot create a route
    // absent from the syntactic graph, so safe origins need no second traversal.
    if (!inspectionCandidates.has(entryPath) && !relevant.some(rule => candidatePaths.get(rule)!.has(entryPath))) continue;
    const seen = new Set<string>();
    const queue = [{ file: entry, path: [] as Edge[] }];
    for (let index = 0; index < queue.length; index++) {
      const item = queue[index];
      if (seen.has(item.file)) continue;
      seen.add(item.file);
      for (const edge of dependencies(item.file, relevant)) {
        if (uninspectable(edge)) incomplete.add(`${edge.from}:${edge.line} -> ${edge.specifier ?? '<computed import>'}`);
        if (!edge.resolved || !edge.to) continue;
        const path = [...item.path, { from: edge.from, line: edge.line, specifier: edge.specifier, to: edge.to }];
        for (const rule of relevant) if (matchesTarget(rule, edge.to)) violations.push({ entry: entryPath, rule, path });
        if (localScript(edge)) {
          queue.push({ file: edge.resolved.resolvedFileName, path });
        }
      }
    }
  }
  return { violations, incomplete: [...incomplete], inspectedModules: modules.size, compilerEmits };
}

const fixtureSemantic = `${semantic}model.ts`;
const fixtureDialogue = `${dialogue}renderer.ts`;
function fixture(source: string, entry = fixtureSemantic, extra: Record<string, string> = {}, overrides: ts.CompilerOptions = {}) {
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
  const options: ts.CompilerOptions = { ...compilerConfig.options,
    baseUrl: repository, paths: { '@fixture/*': ['src/*'] }, ...overrides };
  return checkDirections(repository, [resolve(repository, entry)], options, host);
}

function assertDirections(result: ReturnType<typeof checkDirections>) {
  expect(result.incomplete, 'Every reachable runtime import must be inspectable').toEqual([]);
  expect(result.violations, 'Dependency direction violations (entry and full import path)').toEqual([]);
}

describe('weekly planning module dependency directions', () => {
  // Repository scan measured 0.8–1.5s isolated / 2.7–4.8s under npm run verify.
  // Allow shared-runner scheduling variance after restricting compiler emit.
  it('holds on the resolved production graph without exceptions', () => {
    expect(config.error).toBeUndefined();
    expect(compilerConfig.errors).toEqual([]);
    const entries = productionFiles(join(repository, weekly));
    expect(entries.filter(file => portable(file).includes('/semantic/')).length).toBeGreaterThan(100);
    expect(entries.filter(file => portable(file).includes('/dialogue/')).length).toBeGreaterThan(10);
    const result = checkDirections(repository, entries, compilerConfig.options, ts.sys);
    expect(result.inspectedModules).toBeGreaterThan(entries.length);
    assertDirections(result);
  }, 10_000);

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

  it('allows a normal contract import used only as an exported type after compiler erasure', () => {
    assertDirections(fixture("import { Contract } from '@fixture/repositories/backend'; export type Result = Contract;"));
  });

  it.each([
    "import { Contract as Port } from '@fixture/repositories/backend'; export type Result = Port;",
    "import * as Backend from '@fixture/repositories/backend'; export type Result = Backend.Contract;",
    "import Model from '@fixture/repositories/backend'; export type Result = Model;",
    "import { persist } from '@fixture/repositories/backend'; export type Result = typeof persist;",
  ])('allows erased alias/namespace/default/type-query imports: %s', source => {
    assertDirections(fixture(source, fixtureSemantic, {
      'src/repositories/backend.ts': 'export interface Contract {} export default class Model {} export const persist = () => {};',
    }));
  });

  it.each([
    "import { Contract, persist } from '@fixture/repositories/backend'; export type Result = Contract; persist();",
    "import Model from '@fixture/repositories/backend'; export class Result extends Model {}",
  ])('retains mixed/default imports with actual value use: %s', source => {
    const result = fixture(source, fixtureSemantic, {
      'src/repositories/backend.ts': 'export interface Contract {} export default class Model {} export const persist = () => {};',
    });
    expect(result.incomplete).toEqual([]);
    expect(result.violations.map(hit => hit.rule)).toEqual(['semantic-dialogue-persistence']);
  });

  it.each([
    "import { Contract } from '@fixture/repositories/backend'; export type Result = Contract;",
    "import { type Contract } from '@fixture/repositories/backend'; export type Result = Contract;",
    "export { type Contract } from '@fixture/repositories/backend';",
  ])('follows verbatimModuleSyntax when a type spelling still emits an edge: %s', source => {
    assertDirections(fixture(source, fixtureSemantic, {}, { verbatimModuleSyntax: false }));
    const result = fixture(source, fixtureSemantic, {}, { verbatimModuleSyntax: true });
    expect(result.incomplete).toEqual([]);
    expect(result.violations.map(hit => hit.rule)).toEqual(['semantic-dialogue-persistence']);
  });

  it('still erases whole import-type declarations in verbatim mode', () => {
    assertDirections(fixture("import type { Contract } from '@fixture/repositories/backend'; export type Result = Contract;",
      fixtureSemantic, {}, { verbatimModuleSyntax: true }));
  });

  it.each([false, true])('lets compiler erasure handle type use with isolatedModules=%s', isolatedModules => {
    assertDirections(fixture("import { Contract } from '@fixture/repositories/backend'; export type Result = Contract;",
      fixtureSemantic, {}, { isolatedModules }));
  });

  it('does not impose an unused-binding restriction when the compiler allows it', () => {
    assertDirections(fixture("import { Contract } from '@fixture/repositories/backend';",
      fixtureSemantic, {}, { noUnusedLocals: false }));
  });

  it('handles an empty named import according to compiler emission', () => {
    assertDirections(fixture("import {} from '@fixture/repositories/backend';"));
    const result = fixture("import {} from '@fixture/repositories/backend';", fixtureSemantic, {}, { verbatimModuleSyntax: true });
    expect(result.incomplete).toEqual([]);
    expect(result.violations.map(hit => hit.rule)).toEqual(['semantic-dialogue-persistence']);
  });

  it('does not emit ordinary allowed dependencies just to build the graph', () => {
    const result = fixture("import { unit } from '@fixture/types/domain'; export const selected = unit;", fixtureSemantic, {
      'src/types/domain.ts': 'export const unit = 1;',
    });
    assertDirections(result);
    expect(result.compilerEmits).toBe(0);
  });

  it('still checks compiler erasure through a barrel that can reach persistence', () => {
    const result = fixture("import { Contract } from '../../../../shared/barrel'; export type Result = Contract;", fixtureSemantic, {
      'shared/barrel.ts': "export * from '../src/repositories/backend';",
    });
    assertDirections(result);
    expect(result.compilerEmits).toBe(1);
  });

  it('keeps an executable alternate path when a type-only path to the same barrel is erased', () => {
    const result = fixture(`
      import { Contract } from '../../../../shared/barrel';
      import '../../../../shared/bridge';
      export type Result = Contract;
    `, fixtureSemantic, {
      'shared/barrel.ts': "export * from '../src/repositories/backend';",
      'shared/bridge.ts': "export * from './barrel';",
    });
    expect(result.incomplete).toEqual([]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].path.map(edge => edge.to)).toEqual([
      'shared/bridge.ts', 'shared/barrel.ts', 'src/repositories/backend.ts',
    ]);
    expect(result.compilerEmits).toBe(1);
  });

  it('does not report uninspectable code reached only through an erased type import', () => {
    const result = fixture("import { Contract } from '../../../../shared/helper'; export type Result = Contract;", fixtureSemantic, {
      'shared/helper.ts': "export interface Contract {} const target = './backend'; import(target);",
    });
    assertDirections(result);
    expect(result.compilerEmits).toBe(1);
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
