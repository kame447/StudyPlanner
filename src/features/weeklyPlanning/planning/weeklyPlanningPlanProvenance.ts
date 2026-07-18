export const WEEKLY_PLANNING_PLAN_SOURCE_TYPE = 'weekly-planning' as const;
const WEEKLY_PLANNING_PLAN_SOURCE_ID_VERSION = 'v1';

export interface WeeklyPlanningPlanSourceIdentity {
  approvalOperationId: string;
  sourceDraftBlockId: string;
}

function requireIdentityPart(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function buildWeeklyPlanningPlanSourceId(
  identity: WeeklyPlanningPlanSourceIdentity,
): string {
  const operationId = requireIdentityPart(
    identity.approvalOperationId,
    'approvalOperationId',
  );
  const blockId = requireIdentityPart(
    identity.sourceDraftBlockId,
    'sourceDraftBlockId',
  );
  return [
    WEEKLY_PLANNING_PLAN_SOURCE_ID_VERSION,
    encodeURIComponent(operationId),
    encodeURIComponent(blockId),
  ].join(':');
}

export function parseWeeklyPlanningPlanSourceId(
  value: string | null | undefined,
): WeeklyPlanningPlanSourceIdentity | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length !== 3 || parts[0] !== WEEKLY_PLANNING_PLAN_SOURCE_ID_VERSION) {
    return null;
  }
  try {
    const approvalOperationId = decodeURIComponent(parts[1]).trim();
    const sourceDraftBlockId = decodeURIComponent(parts[2]).trim();
    return approvalOperationId && sourceDraftBlockId
      ? { approvalOperationId, sourceDraftBlockId }
      : null;
  } catch {
    return null;
  }
}
