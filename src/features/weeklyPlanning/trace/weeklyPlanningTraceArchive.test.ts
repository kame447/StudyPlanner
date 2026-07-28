import { describe, expect, it } from 'vitest';
import {
  hasUnexportedWeeklyPlanningTraceActivity,
  hasWeeklyPlanningTraceActivity,
} from './weeklyPlanningTraceArchive';
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
  it('未archiveで活動があるsessionを表示対象にする', () => {
    expect(hasWeeklyPlanningTraceActivity(SESSION)).toBe(true);
    expect(hasUnexportedWeeklyPlanningTraceActivity(SESSION)).toBe(true);
  });

  it('未archiveでもturnとentryが0件の空sessionを表示対象にしない', () => {
    const emptySession = {
      ...SESSION,
      turnCount: 0,
      entryCount: 0,
    };

    expect(hasWeeklyPlanningTraceActivity(emptySession)).toBe(false);
    expect(hasUnexportedWeeklyPlanningTraceActivity(emptySession)).toBe(false);
  });

  it('turnだけまたはentryだけが存在する部分sessionは活動ありとして扱う', () => {
    expect(hasUnexportedWeeklyPlanningTraceActivity({
      ...SESSION,
      turnCount: 1,
      entryCount: 0,
    })).toBe(true);
    expect(hasUnexportedWeeklyPlanningTraceActivity({
      ...SESSION,
      turnCount: 0,
      entryCount: 1,
    })).toBe(true);
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