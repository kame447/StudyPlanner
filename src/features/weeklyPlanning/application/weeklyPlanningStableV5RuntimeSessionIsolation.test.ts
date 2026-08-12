import { afterEach, describe, expect, it } from 'vitest';
import {
  clearWeeklyPlanningSessionRuntime,
  getWeeklyPlanningSessionRuntime,
  publishWeeklyPlanningSessionRuntime,
} from '../planning/weeklyPlanningSessionRuntime';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  clearWeeklyPlanningStableV5RuntimeSession,
  commitWeeklyPlanningStableV5RuntimeGraph,
  finalizeWeeklyPlanningStableV5RuntimeGraph,
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

const LEGACY_SNAPSHOT = {
  conversationId: 'legacy-conversation',
  stateRevision: 7,
  proposalRecords: [],
} as const;

function publishLegacyRuntime(): void {
  publishWeeklyPlanningSessionRuntime(LEGACY_SNAPSHOT);
}

afterEach(() => {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  clearWeeklyPlanningSessionRuntime();
});

describe('Stable V5 runtime isolation from legacy session runtime', () => {
  it('does not overwrite the legacy runtime when a Stable V5 session is hydrated', () => {
    publishLegacyRuntime();

    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: 'owner-1',
      weekStartDate: '2026-08-10',
      conversationId: 'stable-conversation',
      graph: {
        ...createEmptyWeeklyPlanningFactGraphV5(),
        revision: 3,
      },
    });

    expect(getWeeklyPlanningSessionRuntime()).toMatchObject(LEGACY_SNAPSHOT);
  });

  it('does not overwrite the legacy runtime when a staged Stable V5 graph is finalized', () => {
    publishLegacyRuntime();
    bindWeeklyPlanningStableV5RuntimeSessionScope({
      ownerId: 'owner-1',
      weekStartDate: '2026-08-10',
      conversationId: 'stable-conversation',
    });
    commitWeeklyPlanningStableV5RuntimeGraph({
      ownerId: 'owner-1',
      conversationId: 'stable-conversation',
      graph: {
        ...createEmptyWeeklyPlanningFactGraphV5(),
        revision: 1,
        appliedTurnKeys: ['stable-conversation:request-1'],
      },
    });

    finalizeWeeklyPlanningStableV5RuntimeGraph({
      ownerId: 'owner-1',
      conversationId: 'stable-conversation',
      requestId: 'request-1',
    });

    expect(getWeeklyPlanningSessionRuntime()).toMatchObject(LEGACY_SNAPSHOT);
  });

  it('does not clear the legacy runtime when a Stable V5 session is cleared or reset', () => {
    publishLegacyRuntime();
    bindWeeklyPlanningStableV5RuntimeSessionScope({
      ownerId: 'owner-1',
      weekStartDate: '2026-08-10',
      conversationId: 'stable-conversation',
    });

    clearWeeklyPlanningStableV5RuntimeSession('stable-conversation');
    expect(getWeeklyPlanningSessionRuntime()).toMatchObject(LEGACY_SNAPSHOT);

    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    expect(getWeeklyPlanningSessionRuntime()).toMatchObject(LEGACY_SNAPSHOT);
  });
});
