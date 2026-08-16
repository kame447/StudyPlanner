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
  it('encapsulates graph freshness and repair-safe preview projection behind one facade', () => {
    expect(projectionSource).toContain('function withFreshestAvailableGraph(');
    expect(projectionSource).toContain('function withRepairSafePreview(');
    expect(projectionSource).toContain('weeklyPlanningStableV5ResultProjector = {');
    expect(projectionSource).toContain('duplicate: projectDuplicateResult');
    expect(projectionSource).toContain('core: projectCoreResult');

    expect(idempotencySource).toContain('weeklyPlanningStableV5ResultProjector.duplicate');
    expect(instrumentedSource).not.toContain('weeklyPlanningStableV5ResultProjector.duplicate');
    expect(instrumentedSource).toContain('weeklyPlanningStableV5ResultProjector.core');
    expect(instrumentedSource).not.toContain('getWeeklyPlanningStableV5StagedGraph');
    expect(instrumentedSource).not.toContain('withRepairSafePreview');
  });

  it('does not re-derive or rewrite effort-question meaning after application routing', () => {
    expect(projectionSource).not.toContain('withHumanScaleEffortQuestion');
    expect(projectionSource).not.toContain('rewriteWeeklyPlanningEffortQuestionV5');
    expect(projectionSource).not.toContain('createWeeklyPlanningEffortQuestionPlanV5');
  });
});
