import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const instrumentedSource = readFileSync(
  new URL('./weeklyPlanningStableV5InstrumentedRuntimeExecutor.ts', import.meta.url),
  'utf8',
);
const lifecycleSource = readFileSync(
  new URL('./weeklyPlanningStableV5RuntimeTraceLifecycle.ts', import.meta.url),
  'utf8',
);

describe('Stable V5 runtime trace lifecycle architecture', () => {
  it('encapsulates turn-level trace start, completion, and failure behind one facade', () => {
    expect(lifecycleSource).toContain('beginWeeklyPlanningStableV5DebugTrace');
    expect(lifecycleSource).toContain("stage: 'runtime_turn_input'");
    expect(lifecycleSource).toContain("stage: 'runtime_turn_output'");
    expect(lifecycleSource).toContain("stage: 'runtime_turn_threw'");
    expect(lifecycleSource).toContain('function finalDecision(');
    expect(lifecycleSource).toContain('function errorDetails(');
    expect(lifecycleSource).toContain('weeklyPlanningStableV5RuntimeTraceLifecycle = {');
    expect(lifecycleSource).toContain('start: startRuntimeTrace');
    expect(lifecycleSource).toContain('complete: completeRuntimeTrace');
    expect(lifecycleSource).toContain('fail: failRuntimeTrace');

    expect(instrumentedSource).toContain('weeklyPlanningStableV5RuntimeTraceLifecycle.start(input)');
    expect(instrumentedSource).toContain('weeklyPlanningStableV5RuntimeTraceLifecycle.complete({');
    expect(instrumentedSource).toContain('weeklyPlanningStableV5RuntimeTraceLifecycle.fail({');
    expect(instrumentedSource).not.toContain('beginWeeklyPlanningStableV5DebugTrace');
    expect(instrumentedSource).not.toContain('recordWeeklyPlanningStableV5DebugTrace');
    expect(instrumentedSource).not.toContain("stage: 'runtime_turn_input'");
    expect(instrumentedSource).not.toContain("stage: 'runtime_turn_output'");
    expect(instrumentedSource).not.toContain("stage: 'runtime_turn_threw'");
    expect(instrumentedSource).not.toContain('function finalDecision(');
    expect(instrumentedSource).not.toContain('function errorDetails(');
  });

  it('leaves duplicate-specific observability in the idempotency boundary', () => {
    expect(lifecycleSource).not.toContain('runtime_duplicate_turn_suppressed');
  });
});
