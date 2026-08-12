import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runtimeSource = readFileSync(
  new URL('./weeklyPlanningStableV5RuntimeExecutor.ts', import.meta.url),
  'utf8',
);
const semanticContextSource = readFileSync(
  new URL('./weeklyPlanningStableV5SemanticContext.ts', import.meta.url),
  'utf8',
);
const runtimeQuestionsSource = readFileSync(
  new URL('./weeklyPlanningStableV5RuntimeQuestions.ts', import.meta.url),
  'utf8',
);

describe('Stable V5 ambiguity and recovery architecture contract', () => {
  it('publishes active uncertainty context from the semantic-context adapter', () => {
    expect(semanticContextSource).toContain(
      'uncertainties: active.uncertainties.map((uncertainty) => ({',
    );
    expect(semanticContextSource).toContain('publicId: uncertainty.id');
    expect(semanticContextSource).toContain('targetPublicId: uncertainty.targetFactId');
    expect(semanticContextSource).toContain('reason: uncertainty.reason');
    expect(semanticContextSource).toContain('sourceText: uncertainty.source.sourceText');
    expect(runtimeSource).toContain('createStableV5SemanticPublicStateSummary');
  });

  it('keeps ambiguity wording and issue ordering in the question-policy owner', () => {
    expect(runtimeQuestionsSource).toContain("case 'semantic_uncertainty':");
    expect(runtimeQuestionsSource).toContain(
      '「${sourceText}」の意味を一つに決められませんでした。',
    );
    expect(runtimeSource).toContain('decideWeeklyPlanningStableDialogueV5(compilation)');
    expect(runtimeSource).toContain('renderStableV5RuntimeQuestion(semantic.graph, dialogue.question)');
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