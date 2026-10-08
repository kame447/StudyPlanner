import { describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import type { WeeklyPlanningTurnExecutionInput } from '../weeklyPlanningTurnExecutionTypes';
import {
  createWeeklyPlanningTurnRuntimeGateway,
} from './weeklyPlanningTurnRuntimeGateway';

const pending = {
  conversationId: 'conversation-1',
  turnId: 'conversation-1:turn:1',
  requestId: 'conversation-1:request:1',
  weekStartDate: '2026-09-07',
  baseRevision: 6,
  startedAt: '2026-08-11T05:55:30.000Z',
};

describe('weeklyPlanningTurnRuntimeGateway', () => {
  it.each(['interaction_v1', 'legacy_v5'] as const)('projects the typed client preview for renderer use only in %s', async architecture => {
    const executeTurn = vi.fn(async (_request: WeeklyPlanningTurnExecutionInput) => ({ state: createInitialPlanningIntakeState(), message: '', draftCandidates: [] }));
    const gateway = createWeeklyPlanningTurnRuntimeGateway({ executeTurn, bindStableV5SessionScope: vi.fn() });
    const snapshot = createInitialPlanningState('2026-09-07');
    snapshot.previewCandidates = [{ stableKey: 'synthetic', workItemKey: 'work', date: '2030-01-07', startTime: '09:00', endTime: '10:00',
      durationMinutes: 60, title: 'private display label', field: 'subject', year: 0, estimatedMinutes: 60,
      source: 'weekly_exam_prep', approvalStatus: 'unapproved', stableV5Metadata: {
        runtime: 'stable_v5', conversationId: 'conversation-1', graphRevision: 1, taskId: 'task', sourceFactRefs: [], planType: 'study',
      } } as NonNullable<typeof snapshot.previewCandidates>[number]];
    const before = structuredClone(snapshot);
    await gateway.execute({ snapshot, pending, userText: 'a contradictory raw preview description', selectedDate: '2026-09-07',
      userId: 'owner', plans: [], scheduleTemplates: [], conversationArchitecture: architecture });
    const request = executeTurn.mock.calls[0]![0];
    if (architecture === 'interaction_v1') {
      expect(request.currentPreview).toEqual({ candidateCount: 1, placements: [{ taskId: 'task', date: '2030-01-07' }] });
      expect(JSON.stringify(request.currentPreview)).not.toMatch(/private display label|09:00|10:00|contradictory/u);
    } else expect(request).not.toHaveProperty('currentPreview');
    expect(snapshot).toEqual(before);
  });
  it('binds runtime scope and derives request clock before executing the public turn runtime', async () => {
    const executeTurn = vi.fn(async () => ({
      state: createInitialPlanningIntakeState(),
      message: '確認しました。',
      draftCandidates: [],
    }));
    const bindStableV5SessionScope = vi.fn();
    const gateway = createWeeklyPlanningTurnRuntimeGateway({
      executeTurn,
      bindStableV5SessionScope,
    });
    const snapshot = createInitialPlanningState('2026-09-07');

    await gateway.execute({
      snapshot,
      pending,
      userText: '来週の予定を立てたい',
      selectedDate: '2026-09-10',
      userId: 'user-1',
      plans: [],
      scheduleTemplates: [],
      weekStartsOn: 'monday',
      timeZone: 'Asia/Tokyo',
    });

    expect(bindStableV5SessionScope).toHaveBeenCalledWith({
      ownerId: 'user-1',
      weekStartDate: '2026-09-07',
      conversationId: 'conversation-1',
    });
    expect(executeTurn).toHaveBeenCalledWith(expect.objectContaining({
      previousState: undefined,
      messages: [],
      userText: '来週の予定を立てたい',
      selectedDate: '2026-09-10',
      userId: 'user-1',
      conversationId: 'conversation-1',
      traceRequestId: 'conversation-1:request:1',
      weekStartsOn: 'monday',
      inputStateRevision: 6,
      requestContext: {
        startedAtIso: '2026-08-11T05:55:30.000Z',
        timeZone: 'Asia/Tokyo',
        currentDate: '2026-08-11',
        currentTime: '14:55',
        notBeforeDate: '2026-08-11',
        notBeforeTime: '14:56',
        weekStartsOn: 'monday',
      },
    }));
  });

  it('uses the authenticated user id for the runtime scope and execution input', async () => {
    const executeTurn = vi.fn(async () => ({
      state: createInitialPlanningIntakeState(),
      message: '確認しました。',
      draftCandidates: [],
    }));
    const bindStableV5SessionScope = vi.fn();
    const gateway = createWeeklyPlanningTurnRuntimeGateway({
      executeTurn,
      bindStableV5SessionScope,
    });

    await gateway.execute({
      snapshot: createInitialPlanningState('2026-09-07'),
      pending,
      userText: '続けて',
      selectedDate: '2026-09-10',
      userId: 'authenticated-user',
      plans: [],
      scheduleTemplates: [],
    });

    expect(bindStableV5SessionScope).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'authenticated-user',
    }));
    expect(executeTurn).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'authenticated-user',
    }));
  });
});
