import type { DurableWeeklyTurnReceipt } from './weeklyPlanningDurableTurnClient';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';

export function durableReceipt(): DurableWeeklyTurnReceipt {
  const startedAt = '2026-10-13T20:00:00.000Z';
  return { version: 1, ownerId: 'alice', snapshot: createInitialPlanningState('2026-10-12'),
    pending: { conversationId: 'chat', turnId: 'chat:turn:1', requestId: 'chat:request:1', weekStartDate: '2026-10-12', baseRevision: 0, startedAt },
    payload: { weekStartDate: '2026-10-12', graph: createEmptyWeeklyPlanningFactGraphV5(), userContextRecords: [],
      input: { userId: 'alice', conversationId: 'chat', traceRequestId: 'chat:request:1', inputStateRevision: 0,
        messages: [], userText: '今週の予定', selectedDate: '2026-10-13', plans: [], scheduleTemplates: [],
        requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: startedAt, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } } };
}
