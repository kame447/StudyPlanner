import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_PROXY_CHAT_REQUEST_LIMITS, LUNA_REASONING_COMPLETION_FLOOR_TOKENS } from './aiProxyContract';
import {
  WEEKLY_PLANNING_RENDERER_BUDGET_RETRY_MAX_COMPLETION_TOKENS,
  WEEKLY_PLANNING_RENDERER_MAX_COMPLETION_TOKENS,
  WEEKLY_PLANNING_RENDERER_RECOVERY_VERIFICATION_MAX_COMPLETION_TOKENS,
} from '../src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRendererCore';
import { FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS } from '../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedContextualAnswerV5';
import { FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_MAX_COMPLETION_TOKENS } from '../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedTaskTemporalSideContributionV5';
import { SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS } from '../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerRunV5';

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

// Largest GPT-6 Luna completion (reasoning + text) that still produced text, per route, in the
// #305b natural-4 (a7b1a2c8, b4c963a2) and #735 (73d3e7d1, 78c02ad2) ledgers. A cap must leave
// 1.5x headroom over that peak: an exhausted budget yields empty_response (Worker 502), while
// billing follows the tokens actually generated, so headroom costs nothing on successful calls.
const OBSERVED_LUNA_ROUTE_PEAKS = [
  // n=84 at the old 800 default: 7 exhausted; their 1600 retries peaked at 935.
  { route: 'renderer_generation', cap: WEEKLY_PLANNING_RENDERER_MAX_COMPLETION_TOKENS, peak: 935 },
  // n=22 recovery generations share the renderer budget; peak 714 of the old 800.
  { route: 'renderer_recovery', cap: WEEKLY_PLANNING_RENDERER_MAX_COMPLETION_TOKENS, peak: 714 },
  // n=22 at the old 800 default: 2 exhausted, other peak 708.
  { route: 'renderer_verification', cap: WEEKLY_PLANNING_RENDERER_RECOVERY_VERIFICATION_MAX_COMPLETION_TOKENS, peak: 708 },
  // n=86 initial + 32 completeness retries + 15 repairs at 3200: 2 initial exhausted, other peak 2254.
  { route: 'semantic_normalizer', cap: SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS, peak: 2254 },
  { route: 'focused_contextual_answer', cap: FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS, peak: 260 },
  { route: 'focused_temporal_side_contribution', cap: FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_MAX_COMPLETION_TOKENS, peak: 134 },
] as const;

describe('Luna per-route completion budgets', () => {
  it.each(OBSERVED_LUNA_ROUTE_PEAKS)('$route keeps 1.5x headroom over the observed peak within the Worker limit', ({ cap, peak }) => {
    expect(cap).toBeGreaterThanOrEqual(Math.ceil(peak * 1.5));
    expect(cap).toBeGreaterThanOrEqual(LUNA_REASONING_COMPLETION_FLOOR_TOKENS);
    expect(cap).toBeLessThanOrEqual(AI_PROXY_CHAT_REQUEST_LIMITS.maxOutputTokens);
  });

  it('keeps the renderer output-budget retry larger than the initial budget it retries', () => {
    expect(WEEKLY_PLANNING_RENDERER_BUDGET_RETRY_MAX_COMPLETION_TOKENS).toBeGreaterThan(WEEKLY_PLANNING_RENDERER_MAX_COMPLETION_TOKENS);
    expect(WEEKLY_PLANNING_RENDERER_BUDGET_RETRY_MAX_COMPLETION_TOKENS).toBeLessThanOrEqual(AI_PROXY_CHAT_REQUEST_LIMITS.maxOutputTokens);
  });
});
