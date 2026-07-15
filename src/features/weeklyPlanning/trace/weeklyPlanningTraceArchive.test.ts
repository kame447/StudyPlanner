import { describe, expect, it } from 'vitest';
import { hasUnexportedWeeklyPlanningTraceActivity } from './weeklyPlanningTraceArchive';
import type { WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';

const SESSION: WeeklyPlanningTraceSession = {
  id: 'session-1',
  logicalConversationId: 'conversation-1',
  userId: 'user-1',
  status: 'active',
  startedAt: '2026-07-15T00:00:00.000Z',
  lastActivityAt: '2026-07-15T00:00:02.000Z',
  turnCount: 2,
  entryCount: 4,
  hasPreview: false,
  hasApprovalFailure: false,
  hasFallback: false,
  hasError: false,
  appVersion: 'test',
  schemaVersion: 1,
  expireAt: '2026-10-13T00:00:00.000Z',
};

describe('hasUnexportedWeeklyPlanningTraceActivity', () => {
  it('未archiveのsessionを表示対象にする', () => {
    expect(hasUnexportedWeeklyPlanningTraceActivity(SESSION)).toBe(true);
  });

  it('archive後に活動がなければ非表示にする', () => {
    expect(hasUnexportedWeeklyPlanningTraceActivity({
      ...SESSION,
      archivedAt: '2026-07-15T00:00:03.000Z',
    })).toBe(false);
  });

  it('archive後に新しいturnが追記されたsessionを再表示する', () => {
    expect(hasUnexportedWeeklyPlanningTraceActivity({
      ...SESSION,
      archivedAt: '2026-07-15T00:00:01.000Z',
    })).toBe(true);
  });
});
