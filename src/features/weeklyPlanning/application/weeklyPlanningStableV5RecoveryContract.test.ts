import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runtimeSource = readFileSync(
  new URL('./weeklyPlanningStableV5RuntimeExecutor.ts', import.meta.url),
  'utf8',
);

describe('Stable V5 ambiguity and recovery architecture contract', () => {
  it('publishes active uncertainty context to the semantic AI', () => {
    expect(runtimeSource).toContain(
      'uncertainties: active.uncertainties.map((uncertainty) => ({',
    );
    expect(runtimeSource).toContain('publicId: uncertainty.id');
    expect(runtimeSource).toContain('targetPublicId: uncertainty.targetFactId');
    expect(runtimeSource).toContain('reason: uncertainty.reason');
    expect(runtimeSource).toContain('sourceText: uncertainty.source.sourceText');
  });

  it('asks about the ambiguous source fragment before other scheduler issues', () => {
    expect(runtimeSource).toContain("case 'semantic_uncertainty':");
    expect(runtimeSource).toContain(
      '「${sourceText}」の意味を一つに決められませんでした。',
    );
    expect(runtimeSource.indexOf("'semantic_uncertainty'"))
      .toBeLessThan(runtimeSource.indexOf("'planning_horizon'"));
  });

  it('never asks the user to resend the same content after structural rejection', () => {
    expect(runtimeSource).not.toContain(
      '同じ内容をそのままもう一度送ってください。',
    );
    expect(runtimeSource).toContain(
      '予定条件には反映していません。まず、いつの予定を作るか、または何を進めるかを一つだけ教えてください。',
    );
  });
});
