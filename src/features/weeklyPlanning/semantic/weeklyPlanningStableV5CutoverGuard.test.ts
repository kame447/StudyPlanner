import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningSessionCutoverMarker,
  evaluateWeeklyPlanningExecutorReadAccess,
  evaluateWeeklyPlanningExecutorWriteAccess,
  validateWeeklyPlanningSessionCutoverMarker,
} from './weeklyPlanningStableV5CutoverGuard';

describe('Stable V5 session cutover guard', () => {
  it('allows only the executor generation recorded for the session', () => {
    const marker = createWeeklyPlanningSessionCutoverMarker({
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      generation: 'stable_v5',
      stableGraphRevision: 4,
      cutoverAt: '2026-07-22T15:30:00.000Z',
    });

    expect(evaluateWeeklyPlanningExecutorReadAccess({
      marker,
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      executorGeneration: 'stable_v5',
      stableGraphRevision: 4,
    })).toEqual({ allowed: true, reason: 'allowed' });

    expect(evaluateWeeklyPlanningExecutorReadAccess({
      marker,
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      executorGeneration: 'legacy',
    })).toEqual({ allowed: false, reason: 'generation-mismatch' });

    expect(evaluateWeeklyPlanningExecutorWriteAccess({
      marker,
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      executorGeneration: 'legacy',
    })).toEqual({
      allowed: false,
      reason: 'legacy-write-after-stable-cutover',
    });
  });

  it('binds Stable access to owner, conversation, and graph revision', () => {
    const marker = createWeeklyPlanningSessionCutoverMarker({
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      generation: 'stable_v5',
      stableGraphRevision: 4,
      cutoverAt: '2026-07-22T15:30:00.000Z',
    });

    expect(evaluateWeeklyPlanningExecutorReadAccess({
      marker,
      ownerId: 'owner-2',
      conversationId: 'conversation-1',
      executorGeneration: 'stable_v5',
      stableGraphRevision: 4,
    }).reason).toBe('owner-mismatch');
    expect(evaluateWeeklyPlanningExecutorReadAccess({
      marker,
      ownerId: 'owner-1',
      conversationId: 'conversation-2',
      executorGeneration: 'stable_v5',
      stableGraphRevision: 4,
    }).reason).toBe('conversation-mismatch');
    expect(evaluateWeeklyPlanningExecutorReadAccess({
      marker,
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      executorGeneration: 'stable_v5',
      stableGraphRevision: 3,
    }).reason).toBe('stable-revision-mismatch');
  });

  it('keeps legacy markers free from a Stable graph revision', () => {
    const marker = createWeeklyPlanningSessionCutoverMarker({
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      generation: 'legacy',
      cutoverAt: '2026-07-22T15:30:00.000Z',
    });

    expect(marker.stableGraphRevision).toBeNull();
    expect(validateWeeklyPlanningSessionCutoverMarker(marker)).toBe(true);
    expect(evaluateWeeklyPlanningExecutorWriteAccess({
      marker,
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      executorGeneration: 'legacy',
    })).toEqual({ allowed: true, reason: 'allowed' });
  });

  it('rejects malformed markers instead of inferring a generation', () => {
    expect(validateWeeklyPlanningSessionCutoverMarker({
      markerVersion: 'weekly-planning-session-cutover-marker-v1',
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
      generation: 'stable_v5',
      stableGraphRevision: null,
      cutoverAt: '2026-07-22T15:30:00.000Z',
    })).toBe(false);
  });
});
