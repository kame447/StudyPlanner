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

const projectorCoreSource = readFileSync(
  new URL('./weeklyPlanningStableV5TurnResultProjectionCore.ts', import.meta.url), 'utf8',
);

describe('Stable V5 turn result projection architecture', () => {
  it('hides renderer, failure diagnostics, failure projection, and result trace behind one facade', () => {
    expect(projectorSource).toContain('weeklyPlanningStableV5TurnResultProjector = {');
    expect(projectorSource).toContain('begin(traceRequestId: string)');
    expect(projectorSource).toContain('projectWeeklyPlanningStableV5TurnResultCore(params, {');
    expect(projectorSource).toContain('takeWeeklyPlanningStableV5FailureDiagnostics');
    expect(projectorCoreSource).toContain('renderWeeklyPlanningStableV5AssistantMessage');
    expect(projectorCoreSource).toContain('turn_executor_result_projected');
    expect(projectorCoreSource).toContain('FAILURE_CODE_BY_STATUS');
    expect(projectorCoreSource).not.toContain('takeWeeklyPlanningStableV5FailureDiagnostics');
    expect(projectorCoreSource).not.toContain('getWeeklyPlanningStableV5RuntimeSession');
    expect(projectorSource).toContain('getSession: getWeeklyPlanningStableV5RuntimeSession');

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
    expect(projectorCoreSource).toContain("provider_failure: 'stable_v5_provider_failure'");
    expect(projectorCoreSource).toContain("normalization_rejected: 'stable_v5_normalization_rejected'");
    expect(projectorCoreSource).toContain("canonicalization_rejected: 'stable_v5_canonicalization_rejected'");
    expect(projectorCoreSource).not.toContain('`stable_v5_${');
  });
});
