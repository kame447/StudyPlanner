import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetUserPlanningContextRuntimeForTestV1 } from '../../userPlanningContext/userPlanningContextSpace';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningPendingTurn } from '../types';
import {
  createWeeklyPlanningTurnStagingLifecycle,
  type WeeklyPlanningTurnStagingLifecycleServices,
} from './weeklyPlanningTurnSideEffects';

const pending: WeeklyPlanningPendingTurn = {
  conversationId: 'conversation-1',
  turnId: 'conversation-1:turn:2',
  requestId: 'conversation-1:request:2',
  weekStartDate: '2026-07-27',
  baseRevision: 3,
  startedAt: '2026-07-24T10:00:00.000Z',
};

const previousGraph = createEmptyWeeklyPlanningFactGraphV5();
const finalizedGraph = {
  ...createEmptyWeeklyPlanningFactGraphV5(),
  revision: 1,
};
const graphReceipt = {
  ownerId: 'user-1',
  conversationId: 'conversation-1',
  requestId: 'conversation-1:request:2',
  previousGraph,
  previousUpdatedAt: 1,
  finalizedGraph,
  finalizedUpdatedAt: 2,
};

function createServices(
  overrides: Partial<WeeklyPlanningTurnStagingLifecycleServices> = {},
): WeeklyPlanningTurnStagingLifecycleServices {
  return {
    hasStagedGraph: vi.fn(() => true),
    finalizeRuntimeGraph: vi.fn(() => ({
      session: {
        ownerId: 'user-1',
        weekStartDate: '2026-07-27',
        conversationId: 'conversation-1',
        graph: finalizedGraph,
        updatedAt: 2,
      },
      receipt: graphReceipt,
    })),
    rollbackRuntimeGraph: vi.fn(() => true),
    discardStagedGraph: vi.fn(),
    ...overrides,
  };
}

describe('weeklyPlanningTurnStagingLifecycle', () => {
  beforeEach(() => {
    resetUserPlanningContextRuntimeForTestV1();
  });

  it('prepares only an existing staged graph and completes it without rollback', () => {
    const services = createServices();
    const lifecycle = createWeeklyPlanningTurnStagingLifecycle(services);

    const prepared = lifecycle.prepare({ ownerId: 'user-1', pending });
    expect(prepared).toBeDefined();
    prepared?.complete();
    lifecycle.discard(pending);

    expect(services.hasStagedGraph).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:2',
    });
    expect(services.finalizeRuntimeGraph).toHaveBeenCalledWith({
      ownerId: 'user-1',
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:2',
    });
    expect(services.rollbackRuntimeGraph).not.toHaveBeenCalled();
    expect(services.discardStagedGraph).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:2',
    });
  });

  it('rolls a prepared graph back when the outer conversation commit is rejected', () => {
    const services = createServices();
    const lifecycle = createWeeklyPlanningTurnStagingLifecycle(services);

    const prepared = lifecycle.prepare({ ownerId: 'user-1', pending });
    prepared?.rollback();
    prepared?.complete();

    expect(services.rollbackRuntimeGraph).toHaveBeenCalledTimes(1);
    expect(services.rollbackRuntimeGraph).toHaveBeenCalledWith(graphReceipt);
  });

  it('does not prepare when neither staged graph nor context exists', () => {
    const services = createServices({ hasStagedGraph: vi.fn(() => false) });
    const lifecycle = createWeeklyPlanningTurnStagingLifecycle(services);

    const prepared = lifecycle.prepare({ ownerId: 'user-1', pending });

    expect(prepared).toBeUndefined();
    expect(services.finalizeRuntimeGraph).not.toHaveBeenCalled();
    expect(services.rollbackRuntimeGraph).not.toHaveBeenCalled();
  });
});
