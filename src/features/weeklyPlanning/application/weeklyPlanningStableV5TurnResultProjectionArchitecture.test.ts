import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const executorSource = readFileSync(
  new URL('../weeklyPlanningTurnExecutor.ts', import.meta.url),
  'utf8',
);
const projectorSource = readFileSync(
  new URL('./weeklyPlanningStableV5TurnResultProjection.ts', import.meta.url),
  'utf8',
);

describe('Stable V5 turn result projection architecture', () => {
  it('hides renderer, failure diagnostics, failure projection, and result trace behind one facade', () => {
    expect(projectorSource).toContain('weeklyPlanningStableV5TurnResultProjector = {');
    expect(projectorSource).toContain('begin: beginTurnResultProjection');
    expect(projectorSource).toContain('project: projectTurnResult');
    expect(projectorSource).toContain('takeWeeklyPlanningStableV5FailureDiagnostics');
    expect(projectorSource).toContain('renderWeeklyPlanningStableV5AssistantMessage');
    expect(projectorSource).toContain('turn_executor_result_projected');
    expect(projectorSource).toContain('FAILURE_CODE_BY_STATUS');

    expect(executorSource).toContain('weeklyPlanningStableV5TurnResultProjector.begin(');
    expect(executorSource).toContain('weeklyPlanningStableV5TurnResultProjector.project(');
    expect(executorSource).not.toContain('takeWeeklyPlanningStableV5FailureDiagnostics');
    expect(executorSource).not.toContain('renderWeeklyPlanningStableV5AssistantMessage');
    expect(executorSource).not.toContain('recordWeeklyPlanningStableV5DebugTrace');
    expect(executorSource).not.toContain('createWeeklyPlanningSystemDialogueRendererTrace');
    expect(executorSource).not.toContain('stable_v5_canonicalization_rejected');
    expect(executorSource).not.toContain("status: 'revision_pending'");
  });

  it('maps failure status explicitly instead of synthesizing a failure-code string', () => {
    expect(projectorSource).toContain("provider_failure: 'stable_v5_provider_failure'");
    expect(projectorSource).toContain("normalization_rejected: 'stable_v5_normalization_rejected'");
    expect(projectorSource).toContain("canonicalization_rejected: 'stable_v5_canonicalization_rejected'");
    expect(projectorSource).not.toContain('`stable_v5_${');
  });
});
