import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningTraceAdminDiagnostics,
  hasArchivedWeeklyPlanningTraceActivity,
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

describe('weekly planning trace archive and diagnostics', () => {
  it('未archiveで活動があるsessionを表示対象にする', () => {
    expect(hasWeeklyPlanningTraceActivity(SESSION)).toBe(true);
    expect(hasUnexportedWeeklyPlanningTraceActivity(SESSION)).toBe(true);
    expect(hasArchivedWeeklyPlanningTraceActivity(SESSION)).toBe(false);
  });

  it('未archiveでもturnとentryが0件の空sessionを通常表示しない', () => {
    const emptySession = { ...SESSION, turnCount: 0, entryCount: 0 };
    expect(hasWeeklyPlanningTraceActivity(emptySession)).toBe(false);
    expect(hasUnexportedWeeklyPlanningTraceActivity(emptySession)).toBe(false);
    expect(hasArchivedWeeklyPlanningTraceActivity(emptySession)).toBe(false);
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

  it('archive済みで新しい活動がないsessionだけをarchive一覧対象にする', () => {
    const archived = {
      ...SESSION,
      archivedAt: '2026-07-15T00:00:03.000Z',
    };
    expect(hasUnexportedWeeklyPlanningTraceActivity(archived)).toBe(false);
    expect(hasArchivedWeeklyPlanningTraceActivity(archived)).toBe(true);
  });

  it('archive後に新しい活動があれば未export一覧へ戻す', () => {
    const changedAfterArchive = {
      ...SESSION,
      archivedAt: '2026-07-15T00:00:01.000Z',
    };
    expect(hasUnexportedWeeklyPlanningTraceActivity(changedAfterArchive)).toBe(true);
    expect(hasArchivedWeeklyPlanningTraceActivity(changedAfterArchive)).toBe(false);
  });

  it('raw、mapping、activity、empty、unexportedの件数を分離する', () => {
    const empty = { ...SESSION, id: 'empty', turnCount: 0, entryCount: 0 };
    const archived = {
      ...SESSION,
      id: 'archived',
      archivedAt: '2026-07-15T00:00:03.000Z',
    };
    expect(createWeeklyPlanningTraceAdminDiagnostics({
      rawCount: 4,
      mappedSessions: [SESSION, empty, archived],
    })).toEqual({
      rawCount: 4,
      mappedCount: 3,
      malformedCount: 1,
      activityCount: 2,
      emptyCount: 1,
      unexportedCount: 1,
    });
  });
});
