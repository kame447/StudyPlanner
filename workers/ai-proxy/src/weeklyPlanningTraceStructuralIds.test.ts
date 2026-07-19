import { describe, expect, it } from 'vitest';
import { safeWeeklyPlanningTraceDocumentsForAdmin } from './weeklyPlanningTraceApi';
import { prepareWeeklyPlanningTraceWrite } from './weeklyPlanningTracePrivacy';

const SESSION_ID = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';
const OTHER_SESSION_ID = 'weekly-trace-223e4567-e89b-12d3-a456-426614174000';
const CONVERSATION_ID = 'weekly-conversation-323e4567-e89b-12d3-a456-426614174000';

describe('weekly planning trace structural identifiers', () => {
  it('keeps random correlation IDs unique while removing account identity', () => {
    const prepared = prepareWeeklyPlanningTraceWrite({
      session: {
        id: SESSION_ID,
        logicalConversationId: CONVERSATION_ID,
        userId: 'firebase-user-123',
      },
      entries: [{
        id: `${SESSION_ID}-00000000`,
        sessionId: SESSION_ID,
        logicalConversationId: CONVERSATION_ID,
        userId: 'firebase-user-123',
      }],
    }, { token: 'wpt_subject', epoch: '100' }, '2026-07-19T00:00:00.000Z');

    expect(prepared.session.id).toBe(SESSION_ID);
    expect(prepared.session.logicalConversationId).toBe(CONVERSATION_ID);
    expect(prepared.entries[0].sessionId).toBe(SESSION_ID);
    expect(JSON.stringify(prepared)).not.toContain('firebase-user-123');
  });

  it('preserves distinct admin lookup handles instead of collapsing UUIDs', () => {
    const documents = safeWeeklyPlanningTraceDocumentsForAdmin([
      { id: SESSION_ID, logicalConversationId: CONVERSATION_ID, traceSubjectToken: 'wpt_a' },
      { id: OTHER_SESSION_ID, logicalConversationId: CONVERSATION_ID, traceSubjectToken: 'wpt_b' },
    ]);

    expect(documents.map((document) => document.id)).toEqual([SESSION_ID, OTHER_SESSION_ID]);
    expect(JSON.stringify(documents)).not.toContain('traceSubjectToken');
  });
});
