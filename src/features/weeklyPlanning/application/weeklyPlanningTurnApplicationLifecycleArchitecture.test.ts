import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const applicationSource = readFileSync(
  new URL('./weeklyPlanningTurnApplication.ts', import.meta.url),
  'utf8',
);
const outcomeSource = readFileSync(
  new URL('./weeklyPlanningTurnOutcomeLifecycle.ts', import.meta.url),
  'utf8',
);
const stagingSource = readFileSync(
  new URL('./weeklyPlanningTurnSideEffects.ts', import.meta.url),
  'utf8',
);

describe('weekly planning turn application lifecycle architecture', () => {
  it('uses small staging and outcome facades instead of individual side-effect functions', () => {
    expect(applicationSource).toContain('stagingLifecycle: WeeklyPlanningTurnStagingLifecycle');
    expect(applicationSource).toContain('outcomeLifecycle: WeeklyPlanningTurnOutcomeLifecycle');
    expect(applicationSource).toContain('services.stagingLifecycle.finalize(');
    expect(applicationSource).toContain('services.stagingLifecycle.discard(');
    expect(applicationSource).toContain('services.outcomeLifecycle.committed(');
    expect(applicationSource).toContain('services.outcomeLifecycle.discarded(');
    expect(applicationSource).toContain('services.outcomeLifecycle.failed(');

    expect(applicationSource).not.toContain('saveOwnedWeeklyPlanningState');
    expect(applicationSource).not.toContain('recordCommittedWeeklyPlanningApplicationTurn');
    expect(applicationSource).not.toContain('recordDiscardedWeeklyPlanningApplicationTurn');
    expect(applicationSource).not.toContain('recordFailedWeeklyPlanningApplicationTurn');
    expect(applicationSource).not.toContain('finalizeWeeklyPlanningApplicationTurn');
    expect(applicationSource).not.toContain('discardWeeklyPlanningApplicationTurn');
  });

  it('keeps persistence and tracing inside the outcome lifecycle', () => {
    expect(outcomeSource).toContain('saveOwnedWeeklyPlanningState');
    expect(outcomeSource).toContain('recordCommittedWeeklyPlanningApplicationTurn');
    expect(outcomeSource).toContain('recordDiscardedWeeklyPlanningApplicationTurn');
    expect(outcomeSource).toContain('recordFailedWeeklyPlanningApplicationTurn');
    expect(outcomeSource).toContain('weeklyPlanningTurnOutcomeLifecycle =');
  });

  it('keeps mandatory finalize/discard semantics behind the staging lifecycle', () => {
    expect(stagingSource).toContain('weeklyPlanningTurnStagingLifecycle: WeeklyPlanningTurnStagingLifecycle');
    expect(stagingSource).toContain('finalize: finalizeWeeklyPlanningApplicationTurn');
    expect(stagingSource).toContain('discard: discardWeeklyPlanningApplicationTurn');
  });
});
