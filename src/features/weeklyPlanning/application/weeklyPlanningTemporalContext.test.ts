import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningTurnRequestContext,
  resolveWeeklyPlanningPlanningHorizon,
} from './weeklyPlanningTemporalContext';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';

function graphWithWindow(value: string): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    planningWindows: [{
      id: 'window-1',
      kind: 'relative_week',
      value,
      start: null,
      end: null,
      source: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        semanticLocalId: 'window-local-1',
        sourceText: '来週の予定を立てたい',
        origin: 'user',
      },
      createdRevision: 1,
    }],
    factLifecycles: [{
      factId: 'window-1',
      status: 'active',
      createdRevision: 1,
      terminalRevision: null,
      supersededByFactId: null,
    }],
  };
}

describe('weekly planning temporal context', () => {
  it('captures the user-local request date independently from the displayed calendar date', () => {
    const context = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-11T05:55:30.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(context).toMatchObject({
      startedAtIso: '2026-08-11T05:55:30.000Z',
      timeZone: 'Asia/Tokyo',
      currentDate: '2026-08-11',
      currentTime: '14:55',
      notBeforeDate: '2026-08-11',
      notBeforeTime: '14:56',
      weekStartsOn: 'monday',
    });
  });

  it('resolves next_week from the request date, not selectedDate', () => {
    const requestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-11T05:55:00.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: graphWithWindow('next_week'),
      selectedDate: '2026-09-10',
      requestContext,
    })).toEqual({ startDate: '2026-08-17', endDate: '2026-08-23' });
  });

  it('honors Sunday-start personalization when grounding next_week', () => {
    const requestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-11T05:55:00.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'sunday',
    });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: graphWithWindow('next_week'),
      selectedDate: '2026-09-10',
      requestContext,
    })).toEqual({ startDate: '2026-08-16', endDate: '2026-08-22' });
  });

  it('reuses a previously proposed absolute range instead of shifting the same relative fact on a later date', () => {
    const laterRequestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-18T05:55:00.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: graphWithWindow('next_week'),
      selectedDate: '2026-09-10',
      requestContext: laterRequestContext,
      groundingRecords: [{
        id: 'grounding:window-1:2026-08-17:2026-08-23',
        targetFactId: 'window-1',
        interpretationKind: 'relative_date_resolution',
        status: 'proposed',
        sourceExpression: 'next_week',
        startDate: '2026-08-17',
        endDate: '2026-08-23',
        proposedAtTurnId: 'request-1',
        acceptedAtTurnId: null,
      }],
    })).toEqual({ startDate: '2026-08-17', endDate: '2026-08-23' });
  });

  it('uses selectedDate only as the fallback seed when the user has no planning window', () => {
    const requestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-11T05:55:00.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(resolveWeeklyPlanningPlanningHorizon({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      selectedDate: '2026-09-10',
      requestContext,
    })).toEqual({ startDate: '2026-09-10', endDate: '2026-09-16' });
  });

  it('caps the not-before time at 24:00 instead of rolling deictic today into tomorrow', () => {
    const context = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-11T14:59:30.000Z',
      timeZone: 'Asia/Tokyo',
      weekStartsOn: 'monday',
    });

    expect(context.currentDate).toBe('2026-08-11');
    expect(context.currentTime).toBe('23:59');
    expect(context.notBeforeDate).toBe('2026-08-11');
    expect(context.notBeforeTime).toBe('24:00');
  });
});
