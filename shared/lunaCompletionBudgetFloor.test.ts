import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_PROXY_CHAT_REQUEST_LIMITS, LUNA_REASONING_COMPLETION_FLOOR_TOKENS } from './aiProxyContract';

const ROOT = join(__dirname, '..');
const SOURCE_ROOTS = ['src', 'shared', 'workers/ai-proxy/src'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test(Utils)?\.tsx?$|\.testUtils\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const files = SOURCE_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)));
const exportedBudgets = files.flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/export const (\w+_MAX_COMPLETION_TOKENS)\s*=/g)]
    .map((match) => ({ file, name: match[1] })));
const literalBudgets = files.flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/\b(?:maxCompletionTokens|max_completion_tokens)\s*:\s*(\d[\d_]*)\b/g)]
    .map((match) => ({ file: relative(ROOT, file), tokens: Number(match[1].replace(/_/g, '')) })));

describe('Luna completion budget floor', () => {
  it('documents a floor above observed GPT-6 Luna reasoning and within the Worker limits', () => {
    expect(LUNA_REASONING_COMPLETION_FLOOR_TOKENS).toBeGreaterThan(338);
    expect(LUNA_REASONING_COMPLETION_FLOOR_TOKENS).toBeLessThanOrEqual(AI_PROXY_CHAT_REQUEST_LIMITS.defaultOutputTokens);
  });

  it('finds the exported completion budget catalog', () => {
    expect(exportedBudgets.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS',
      'FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS',
      'FOCUSED_PLANNING_WINDOW_REPAIR_MAX_COMPLETION_TOKENS',
      'FOCUSED_TEMPORAL_SCOPE_REPAIR_MAX_COMPLETION_TOKENS',
      'FOCUSED_USER_CONTEXT_DATE_REPAIR_MAX_COMPLETION_TOKENS',
    ]));
  });

  it('keeps every exported *_MAX_COMPLETION_TOKENS at or above the floor', async () => {
    const below: string[] = [];
    for (const { file, name } of exportedBudgets) {
      const value = (await import(/* @vite-ignore */ file) as Record<string, unknown>)[name];
      if (typeof value !== 'number' || value < LUNA_REASONING_COMPLETION_FLOOR_TOKENS) below.push(`${relative(ROOT, file)} ${name}=${String(value)}`);
    }
    expect(below).toEqual([]);
  });

  it('keeps every inline numeric completion budget at or above the floor', () => {
    expect(literalBudgets.length).toBeGreaterThan(0);
    expect(literalBudgets.filter(({ tokens }) => tokens < LUNA_REASONING_COMPLETION_FLOOR_TOKENS)).toEqual([]);
  });
});
