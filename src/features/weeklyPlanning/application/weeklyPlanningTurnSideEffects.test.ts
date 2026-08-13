import { describe, expect, it, vi } from 'vitest';
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

function createServices(
  overrides: Partial<WeeklyPlanningTurnStagingLifecycleServices> = {},
) {
  return {
    hasStagedGraph: vi.fn(() => true),
    finalizeRuntimeGraph: vi.fn(),
    discardStagedGraph: vi.fn(),
    ...overrides,
  };
}

describe('weeklyPlanningTurnStagingLifecycle', () => {
  it('finalizes only an existing staged graph and discards by conversation and request', () => {
    const services = createServices();
    const lifecycle = createWeeklyPlanningTurnStagingLifecycle(services);

    lifecycle.finalize({ ownerId: 'user-1', pending });
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
    expect(services.discardStagedGraph).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:2',
    });
  });

  it('does not finalize when neither staged graph nor context exists', () => {
    const services = createServices({ hasStagedGraph: vi.fn(() => false) });
    const lifecycle = createWeeklyPlanningTurnStagingLifecycle(services);

    lifecycle.finalize({ ownerId: 'user-1', pending });

    expect(services.finalizeRuntimeGraph).not.toHaveBeenCalled();
  });
});
