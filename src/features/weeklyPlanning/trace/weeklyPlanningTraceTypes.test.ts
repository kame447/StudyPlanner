import { describe, expect, it } from 'vitest';
import { isWeeklyPlanningTraceEntry } from './weeklyPlanningTraceTypes';

function baseEntry() {
  return {
    id: 'session-1-00000000',
    sessionId: 'session-1',
    logicalConversationId: 'conversation-1',
    userId: 'user-1',
    sequence: 0,
    occurredAt: '2026-07-15T00:00:00.000Z',
    observedAt: '2026-07-15T00:00:00.000Z',
    schemaVersion: 1,
    expireAt: '2026-10-13T00:00:00.000Z',
  };
}

describe('isWeeklyPlanningTraceEntry', () => {
  it('有限catalogにないevent typeをsafe discardする', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'internal_event',
      eventType: 'unknown_event',
      payload: {},
      severity: 'info',
    })).toBe(false);
  });

  it('有限catalogにあるevent typeを受理する', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'internal_event',
      eventType: 'preview_rejected_stale',
      payload: { previewId: 'preview-1' },
      severity: 'warn',
    })).toBe(true);
  });

  it('不正なsnapshot reasonをsafe discardする', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'state_snapshot',
      snapshotReason: 'unknown_reason',
      state: {},
    })).toBe(false);
  });

  it('payload欠落eventをsafe discardする', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'internal_event',
      eventType: 'preview_generated',
      severity: 'info',
    })).toBe(false);
  });

  it('state欠落snapshotをsafe discardする', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'state_snapshot',
      snapshotReason: 'turn_completed',
    })).toBe(false);
  });

  it('assistant turnではresponse sourceを必須にする', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'turn',
      role: 'assistant',
      content: '応答',
      turnIndex: 0,
    })).toBe(false);
  });

});
