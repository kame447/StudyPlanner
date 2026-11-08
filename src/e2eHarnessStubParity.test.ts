import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The harness config and the spec support are plain ESM files with no declarations.
import harnessConfig from '../tests/e2e/harness/vite.config.mjs';
// @ts-expect-error The harness config and the spec support are plain ESM files with no declarations.
import durableConfig from '../tests/e2e/harness/durable.vite.config.mjs';
// @ts-expect-error The harness config and the spec support are plain ESM files with no declarations.
import { unaliasedRuntimeGatewayStubBody } from '../tests/e2e/support/weekly-planning-provider.mjs';

/**
 * The browser harnesses replace some production modules with stubs (tests/e2e/harness/*.vite.config.mjs) and a few
 * specs serve another stub body. A stub that lacks a name the application imports does not fail a unit test: the
 * harness page cannot load, and every browser job that uses it fails (#1075). This reads each alias from the harness
 * configs themselves and checks that the replacement exports every value the importer takes from it.
 */
const srcDir = path.dirname(fileURLToPath(import.meta.url));

interface HarnessPlugin { name?: string; resolveId?: (source: string, importer?: string) => unknown; load?: (id: string) => unknown }
const plugins = [...(harnessConfig.plugins ?? []), ...(durableConfig.plugins ?? [])]
  .flat().filter((plugin: HarnessPlugin) => plugin && typeof plugin.resolveId === 'function') as HarnessPlugin[];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

function parse(file: string, code: string) {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.(js|mjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
}

/** Value names a module takes from `specifier` (type-only imports are erased and need no export). */
function importedValueNames(source: ts.SourceFile): Array<{ specifier: string; names: string[] }> {
  const found: Array<{ specifier: string; names: string[] }> = [];
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const names: string[] = [];
      if (clause.name) names.push('default');
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
      }
      found.push({ specifier: node.moduleSpecifier.text, names });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) {
      found.push({ specifier: node.moduleSpecifier.text,
        names: node.exportClause.elements.filter(element => !element.isTypeOnly).map(element => (element.propertyName ?? element.name).text) });
    }
  }
  return found;
}

/** Exported names of a stub, or 'all' when it re-exports everything from another module. */
function exportedNames(source: ts.SourceFile): Set<string> | 'all' {
  const names = new Set<string>();
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node)) {
      if (!node.exportClause) return 'all';
      if (ts.isNamedExports(node.exportClause)) for (const element of node.exportClause.elements) names.add(element.name.text);
    } else if (ts.isExportAssignment(node)) names.add('default');
    else if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) names.add('default');
      else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text);
    }
  }
  return names;
}

function replacementCode(plugin: HarnessPlugin, resolved: unknown): { id: string; code: string } {
  const id = typeof resolved === 'string' ? resolved : (resolved as { id?: string })?.id ?? '';
  if (id.startsWith('\0')) {
    const loaded = plugin.load?.(id);
    const code = typeof loaded === 'string' ? loaded : (loaded as { code?: string } | null | undefined)?.code;
    if (typeof code !== 'string') throw new Error(`${plugin.name}: ${id} has no source to check`);
    return { id, code };
  }
  return { id, code: fs.readFileSync(id, 'utf8') };
}

interface Alias { plugin: string; importer: string; specifier: string; replacement: string; required: string[]; missing: string[] }

function collectAliases(): Alias[] {
  const aliases: Alias[] = [];
  for (const file of sourceFiles(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const specifiers = [...text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    for (const plugin of plugins) {
      const hits = specifiers.filter(specifier => {
        const resolved = plugin.resolveId!(specifier, file);
        return typeof resolved === 'string' || Boolean(resolved && typeof resolved === 'object');
      });
      if (!hits.length) continue;
      const imports = importedValueNames(parse(file, text));
      for (const specifier of new Set(hits)) {
        const { id, code } = replacementCode(plugin, plugin.resolveId!(specifier, file));
        const exported = exportedNames(parse(id, code));
        const required = [...new Set(imports.filter(entry => entry.specifier === specifier).flatMap(entry => entry.names))];
        aliases.push({ plugin: plugin.name ?? '(unnamed)', importer: path.relative(srcDir, file), specifier,
          replacement: id.startsWith('\0') ? id : path.relative(path.dirname(srcDir), id), required,
          missing: exported === 'all' ? [] : required.filter(name => !exported.has(name)) });
      }
    }
  }
  return aliases;
}

const aliases = collectAliases();

describe('browser harness stubs export what the application imports', () => {
  it('finds the aliases declared in the harness configs, so the check cannot pass by finding none', () => {
    const gateway = aliases.filter(alias => alias.specifier === './weeklyPlanningVNextRuntimeGateway');
    expect(gateway.map(alias => alias.importer)).toEqual([path.normalize('features/weeklyPlanning/vnext/application/useWeeklyPlanningVNextApplication.ts')]);
    expect(gateway[0]!.required).toEqual(expect.arrayContaining(['createWeeklyPlanningVNextRuntimeGateway', 'readWeeklyPlanningVNextDurableReceipt']));
    expect(aliases.some(alias => alias.specifier === './weeklyPlanningTurnRuntimeGateway')).toBe(true);
    expect(aliases.some(alias => alias.plugin === 'durable-turn-synthetic-auth')).toBe(true);
  });

  it('has no alias whose replacement lacks a name its importer takes from it', () => {
    expect(aliases.filter(alias => alias.missing.length).map(alias => `${alias.importer} imports ${alias.missing.join(', ')} from ${alias.specifier}, but ${alias.replacement} does not export it`))
      .toEqual([]);
  });

  it('has no spec that writes its own runtime gateway stub body instead of the shared one (#1075: a copy went stale)', () => {
    const specDir = path.join(path.dirname(srcDir), 'tests/e2e');
    const serving = fs.readdirSync(specDir).filter(name => /\.spec\.mjs$/.test(name))
      .map(name => ({ name, text: fs.readFileSync(path.join(specDir, name), 'utf8') }))
      .filter(spec => spec.text.includes('weeklyPlanningTurnRuntimeGateway.stub.js'));
    expect(serving.length).toBeGreaterThan(0);
    expect(serving.filter(spec => !spec.text.includes('unaliasedRuntimeGatewayStubBody(')
      || /export \{[^}]*createWeeklyPlanningVNextRuntimeGateway/.test(spec.text)).map(spec => spec.name)).toEqual([]);
  });

  it('serves a spec stub body that exports every name both runtime gateways are imported for', () => {
    const body = unaliasedRuntimeGatewayStubBody('/repo') as string;
    const exported = exportedNames(parse('stub-body.mjs', body));
    expect(exported).not.toBe('all');
    const required = aliases.filter(alias => ['./weeklyPlanningVNextRuntimeGateway', './weeklyPlanningTurnRuntimeGateway'].includes(alias.specifier))
      .flatMap(alias => alias.required);
    expect(required.length).toBeGreaterThan(0);
    expect(required.filter(name => !(exported as Set<string>).has(name))).toEqual([]);
  });

  it('detects a stub that lacks a name (the #1075 shape)', () => {
    const stub = exportedNames(parse('stub.js', "export { readWeeklyPlanningVNextDurableReceipt } from './gateway';\nexport function createWeeklyPlanningVNextRuntimeGateway() {}"));
    expect(stub).not.toBe('all');
    expect(['createWeeklyPlanningVNextRuntimeGateway', 'readWeeklyPlanningVNextDurableReceipt', 'removeForgottenRecordFromVNextDurableReceipt']
      .filter(name => !(stub as Set<string>).has(name))).toEqual(['removeForgottenRecordFromVNextDurableReceipt']);
  });
});
