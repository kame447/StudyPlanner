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

describe('Stable V5 turn idempotency architecture', () => {
  it('hides duplicate detection and result construction behind a typed gate', () => {
    expect(idempotencySource).toContain("kind: 'proceed'");
    expect(idempotencySource).toContain("kind: 'duplicate'");
    expect(idempotencySource).toContain('appliedTurnKeys.includes(');
    expect(idempotencySource).toContain('weeklyPlanningStableV5IdempotencyGate = {');

    expect(instrumentedSource).toContain('weeklyPlanningStableV5IdempotencyGate.evaluate(input)');
    expect(instrumentedSource).toContain("idempotency.kind === 'duplicate'");
    expect(instrumentedSource).not.toContain('appliedTurnKeys');
    expect(instrumentedSource).not.toContain('emptyCompatibilityState');
    expect(instrumentedSource).not.toContain('duplicateTurnResult');
    expect(instrumentedSource).not.toContain('getWeeklyPlanningStableV5RuntimeSession');
  });

  it('keeps duplicate result graph projection inside the idempotency boundary', () => {
    expect(idempotencySource).toContain('weeklyPlanningStableV5ResultProjector.duplicate');
    expect(instrumentedSource).not.toContain('weeklyPlanningStableV5ResultProjector.duplicate');
  });
});
