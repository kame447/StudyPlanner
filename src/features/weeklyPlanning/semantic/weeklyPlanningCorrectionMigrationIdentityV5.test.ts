import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { workloadLifecycleFixture } from '../testUtils/weeklyPlanningWorkloadLifecycleFixture';
import { applyWeeklyPlanningCorrectionTransactionV5 } from './weeklyPlanningCorrectionTransactionV5';

it('explicit correction migration is byte-identical to frozen 9622bbf9 output', () => {
  const graph = workloadLifecycleFixture({ correction: true });
  const result = applyWeeklyPlanningCorrectionTransactionV5({ graph, expectedRevision: graph.revision, correctionIntentFactId: 'correction', operationKey: 'identity-op' });
  const sha = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  console.log('CORRECTION_IDENTITY_SHA', sha);
  expect(result.status).toBe('applied');
  // Filled only from the pristine-base run of this synthetic fixture.
  expect(sha).toBe('9b3143aeabd282e56bea15436266aa902ef80242057ce361bc9d84ead0e91b4c');
});
