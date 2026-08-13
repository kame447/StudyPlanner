import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runtimeSource = readFileSync(
  new URL('./weeklyPlanningStableV5RuntimeExecutor.ts', import.meta.url),
  'utf8',
);
const planningEvaluationSource = readFileSync(
  new URL('./weeklyPlanningStableV5PlanningEvaluation.ts', import.meta.url),
  'utf8',
);
const planningStageSource = readFileSync(
  new URL('./weeklyPlanningStableV5PlanningStage.ts', import.meta.url),
  'utf8',
);
const responseRoutingSource = readFileSync(
  new URL('./weeklyPlanningStableV5ResponseRouting.ts', import.meta.url),
  'utf8',
);
const semanticTurnSource = readFileSync(
  new URL('./weeklyPlanningStableV5SemanticTurn.ts', import.meta.url),
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
    expect(semanticTurnSource).toContain('createStableV5SemanticPublicStateSummary');
  });

  it('keeps ambiguity ordering in planning policy and response wording in the routing facade', () => {
    expect(runtimeQuestionsSource).toContain("case 'semantic_uncertainty':");
    expect(runtimeQuestionsSource).toContain(
      '「${sourceText}」の意味を一つに決められませんでした。',
    );
    expect(planningEvaluationSource).toContain(
      'decideWeeklyPlanningStableDialogueV5(compilation)',
    );
    expect(responseRoutingSource).toContain(
      'renderStableV5RuntimeQuestion(graph, dialogue.question)',
    );
    expect(runtimeSource).not.toContain('renderStableV5RuntimeQuestion');
  });

  it('encapsulates planning evaluation observability behind the planning-stage facade', () => {
    expect(planningStageSource).toContain('evaluateWeeklyPlanningStableV5Planning(params)');
    expect(planningStageSource).toContain("stage: 'runtime_scheduler_dialogue_evaluated'");
    expect(planningStageSource).toContain('firstBlockingIssueCodeInCompilationOrder');
    expect(runtimeSource).toContain('runWeeklyPlanningStableV5PlanningStage');
    expect(runtimeSource).not.toContain("stage: 'runtime_scheduler_dialogue_evaluated'");
    expect(runtimeSource).not.toContain('activeStableV5PlanningWindows');
    expect(runtimeSource).not.toContain('firstBlockingIssueCodeInCompilationOrder');
  });

  it('encapsulates response completion versus preview scheduling behind a typed facade', () => {
    expect(responseRoutingSource).toContain("kind: 'respond'");
    expect(responseRoutingSource).toContain("kind: 'schedule_preview'");
    expect(responseRoutingSource).toContain('weeklyPlanningStableV5ResponseRouter = {');
    expect(runtimeSource).toContain('weeklyPlanningStableV5ResponseRouter.beforePreview');
    expect(runtimeSource).toContain('weeklyPlanningStableV5ResponseRouter.afterPreview');
    expect(runtimeSource).toContain("responseRoute.kind === 'respond'");
    expect(runtimeSource).not.toContain('compilation.input!');
  });

  it('never asks the user to resend the same content after structural rejection', () => {
    expect(semanticTurnSource).not.toContain(
      '同じ内容をそのままもう一度送ってください。',
    );
    expect(semanticTurnSource).toContain(
      '予定条件には反映していません。まず、いつの予定を作るか、または何を進めるかを一つだけ教えてください。',
    );
  });
});
