import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEEKLY_PLANNING_ROOT = fileURLToPath(new URL('../', import.meta.url));
const FORBIDDEN_IMPORT_TOKENS = [
  'weeklyPlanningStableV5',
  'weeklyPlanningSemanticDocumentV5',
  'weeklyPlanningFactGraphV5',
  'weeklyPlanningSemanticNormalizerV5',
  'weeklyPlanningSemanticPipelineV5',
  'weeklyPlanningSemanticDialoguePipelineV5',
  'weeklyPlanningStableV5Persistence',
] as const;

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

describe('Stable V5 production isolation', () => {
  it('keeps production weekly planning modules disconnected from Stable V5', () => {
    const violations: string[] = [];
    for (const path of sourceFiles(WEEKLY_PLANNING_ROOT)) {
      const relativePath = normalizedRelative(path);
      if (relativePath.startsWith('semantic/')) continue;
      const content = readFileSync(path, 'utf8');
      for (const token of FORBIDDEN_IMPORT_TOKENS) {
        if (content.includes(token)) violations.push(`${relativePath}:${token}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
