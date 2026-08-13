import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const instrumentedSource = readFileSync(
  new URL('./weeklyPlanningStableV5InstrumentedRuntimeExecutor.ts', import.meta.url),
  'utf8',
);
const idempotencySource = readFileSync(
  new URL('./weeklyPlanningStableV5TurnIdempotency.ts', import.meta.url),
  'utf8',
);
const projectionSource = readFileSync(
  new URL('./weeklyPlanningStableV5ResultProjection.ts', import.meta.url),
  'utf8',
);

describe('Stable V5 result projection architecture', () => {
  it('encapsulates related runtime-result transformations behind one projector facade', () => {
    expect(projectionSource).toContain('function withFreshestAvailableGraph(');
    expect(projectionSource).toContain('function withHumanScaleEffortQuestion(');
    expect(projectionSource).toContain('function withRepairSafePreview(');
    expect(projectionSource).toContain('weeklyPlanningStableV5ResultProjector = {');
    expect(projectionSource).toContain('duplicate: projectDuplicateResult');
    expect(projectionSource).toContain('core: projectCoreResult');

    expect(idempotencySource).toContain('weeklyPlanningStableV5ResultProjector.duplicate');
    expect(instrumentedSource).not.toContain('weeklyPlanningStableV5ResultProjector.duplicate');
    expect(instrumentedSource).toContain('weeklyPlanningStableV5ResultProjector.core');
    expect(instrumentedSource).not.toContain('rewriteWeeklyPlanningEffortQuestionV5');
    expect(instrumentedSource).not.toContain('getWeeklyPlanningStableV5StagedGraph');
    expect(instrumentedSource).not.toContain('withRepairSafePreview');
  });

  it('does not rely on a non-null assertion for graph-aware question projection', () => {
    expect(projectionSource).toContain('const graph = result.stableV5Graph;');
    expect(projectionSource).not.toContain('stableV5Graph!');
  });
});
