import type {
  WeeklyPlanningTraceAdminDiagnostics,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

function timestamp(value: string): number | null {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function hasWeeklyPlanningTraceActivity(
  session: WeeklyPlanningTraceSession,
): boolean {
  return session.turnCount > 0 || session.entryCount > 0;
}

export function hasUnexportedWeeklyPlanningTraceActivity(
  session: WeeklyPlanningTraceSession,
): boolean {
  if (!hasWeeklyPlanningTraceActivity(session)) return false;
  if (!session.archivedAt) return true;

  const lastActivityAt = timestamp(session.lastActivityAt);
  const archivedAt = timestamp(session.archivedAt);
  if (lastActivityAt !== null && archivedAt !== null) {
    return lastActivityAt > archivedAt;
  }
  return session.lastActivityAt.localeCompare(session.archivedAt) > 0;
}

export function hasArchivedWeeklyPlanningTraceActivity(
  session: WeeklyPlanningTraceSession,
): boolean {
  return Boolean(session.archivedAt)
    && hasWeeklyPlanningTraceActivity(session)
    && !hasUnexportedWeeklyPlanningTraceActivity(session);
}

export function createWeeklyPlanningTraceAdminDiagnostics(params: {
  rawCount: number;
  mappedSessions: readonly WeeklyPlanningTraceSession[];
}): WeeklyPlanningTraceAdminDiagnostics {
  const mappedCount = params.mappedSessions.length;
  const activityCount = params.mappedSessions.filter(hasWeeklyPlanningTraceActivity).length;
  const unexportedCount = params.mappedSessions
    .filter(hasUnexportedWeeklyPlanningTraceActivity).length;
  return {
    rawCount: Math.max(0, params.rawCount),
    mappedCount,
    malformedCount: Math.max(0, params.rawCount - mappedCount),
    activityCount,
    emptyCount: mappedCount - activityCount,
    unexportedCount,
  };
}
