import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const applicationSource = readFileSync(
  new URL('./weeklyPlanningTurnApplication.ts', import.meta.url),
  'utf8',
);
const runtimeGatewaySource = readFileSync(
  new URL('./weeklyPlanningTurnRuntimeGateway.ts', import.meta.url),
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
  it('uses a runtime gateway plus small staging and outcome facades', () => {
    expect(applicationSource).toContain('runtimeGateway: WeeklyPlanningTurnRuntimeGateway');
    expect(applicationSource).toContain('stagingLifecycle: WeeklyPlanningTurnStagingLifecycle');
    expect(applicationSource).toContain('outcomeLifecycle: WeeklyPlanningTurnOutcomeLifecycle');
    expect(applicationSource).toContain('services.runtimeGateway.execute(');
    expect(applicationSource).toContain('services.stagingLifecycle.finalize(');
    expect(applicationSource).toContain('services.stagingLifecycle.discard(');
    expect(applicationSource).toContain('services.outcomeLifecycle.committed(');
    expect(applicationSource).toContain('services.outcomeLifecycle.discarded(');
    expect(applicationSource).toContain('services.outcomeLifecycle.failed(');

    expect(applicationSource).not.toContain('executeWeeklyPlanningTurn');
    expect(applicationSource).not.toContain('bindWeeklyPlanningStableV5RuntimeSessionScope');
    expect(applicationSource).not.toContain('createWeeklyPlanningTurnRequestContext');
    expect(applicationSource).not.toContain('saveOwnedWeeklyPlanningState');
    expect(applicationSource).not.toContain('recordCommittedWeeklyPlanningApplicationTurn');
    expect(applicationSource).not.toContain('recordDiscardedWeeklyPlanningApplicationTurn');
    expect(applicationSource).not.toContain('recordFailedWeeklyPlanningApplicationTurn');
  });

  it('keeps runtime scope binding, temporal context and executor mapping inside the runtime gateway', () => {
    expect(runtimeGatewaySource).toContain('bindWeeklyPlanningStableV5RuntimeSessionScope');
    expect(runtimeGatewaySource).toContain('createWeeklyPlanningTurnRequestContext');
    expect(runtimeGatewaySource).toContain('executeWeeklyPlanningTurn');
    expect(runtimeGatewaySource).toContain('createWeeklyPlanningTurnRuntimeGateway(');
    expect(runtimeGatewaySource).toContain('weeklyPlanningTurnRuntimeGateway = createWeeklyPlanningTurnRuntimeGateway()');
  });

  it('keeps persistence and tracing inside the outcome lifecycle', () => {
    expect(outcomeSource).toContain('saveOwnedWeeklyPlanningState');
    expect(outcomeSource).toContain('recordCommittedWeeklyPlanningApplicationTurn');
    expect(outcomeSource).toContain('recordDiscardedWeeklyPlanningApplicationTurn');
    expect(outcomeSource).toContain('recordFailedWeeklyPlanningApplicationTurn');
    expect(outcomeSource).toContain('weeklyPlanningTurnOutcomeLifecycle =');
  });

  it('exposes staging only through a factory and lifecycle facade', () => {
    expect(stagingSource).toContain('function finalizeStaging(');
    expect(stagingSource).toContain('function discardStaging(');
    expect(stagingSource).toContain('createWeeklyPlanningTurnStagingLifecycle(');
    expect(stagingSource).toContain('weeklyPlanningTurnStagingLifecycle = createWeeklyPlanningTurnStagingLifecycle()');
    expect(stagingSource).not.toContain('export function finalizeStaging(');
    expect(stagingSource).not.toContain('export function discardStaging(');
    expect(stagingSource).not.toContain("from './weeklyPlanningTurnTraceSideEffects'");
    expect(stagingSource).not.toContain('recordCommittedWeeklyPlanningApplicationTurn');
    expect(stagingSource).not.toContain('recordDiscardedWeeklyPlanningApplicationTurn');
    expect(stagingSource).not.toContain('recordFailedWeeklyPlanningApplicationTurn');
  });
});
