import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LEGACY_TOKEN = 'weeklyPlanningBehaviorAware';
const STATIC_IMPORT_EXPRESSION = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_EXPRESSION = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

const REQUIRED_LEGACY_ROOTS = new Set([
  'features/weeklyPlanning/planning/weeklyPlanningBehaviorAwarePreviewBridge.ts',
  'features/weeklyPlanning/planning/weeklyPlanningBehaviorAwarePreviewBridgeHardened.ts',
  'features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline.ts',
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
  return relative(SRC_ROOT, path).split(sep).join('/');
}

function isTestSource(relativePath: string): boolean {
  return relativePath.startsWith('__tests__/')
    || relativePath.includes('/__tests__/')
    || /\.(test|spec)\.(ts|tsx)$/.test(relativePath);
}

function importedSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(STATIC_IMPORT_EXPRESSION),
    ...source.matchAll(DYNAMIC_IMPORT_EXPRESSION),
  ].map((match) => match[1]);
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

describe('legacy behavior-aware production isolation', () => {
  it('has no production import edge from outside the isolated behavior-aware cluster', () => {
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

    const violations: string[] = [];
    for (const importer of productionSources) {
      if (legacySources.has(importer)) continue;
      const importerRelative = normalizedRelative(importer);
      const source = readFileSync(importer, 'utf8');
      for (const specifier of importedSpecifiers(source)) {
        if (specifier.includes(LEGACY_TOKEN)) {
          violations.push(`${importerRelative}:${specifier}`);
          continue;
        }
        const resolved = resolveRelativeModule(importer, specifier);
        if (resolved && legacySources.has(resolved)) {
          violations.push(`${importerRelative}:${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
