export const WEEKLY_PLANNING_SESSION_CUTOVER_MARKER_VERSION =
  'weekly-planning-session-cutover-marker-v1' as const;

export type WeeklyPlanningExecutorGeneration = 'legacy' | 'stable_v5';

export interface WeeklyPlanningSessionCutoverMarker {
  markerVersion: typeof WEEKLY_PLANNING_SESSION_CUTOVER_MARKER_VERSION;
  ownerId: string;
  conversationId: string;
  generation: WeeklyPlanningExecutorGeneration;
  stableGraphRevision: number | null;
  cutoverAt: string;
}

export type WeeklyPlanningExecutorAccessReason =
  | 'allowed'
  | 'invalid-marker'
  | 'owner-mismatch'
  | 'conversation-mismatch'
  | 'generation-mismatch'
  | 'stable-revision-mismatch'
  | 'legacy-write-after-stable-cutover';

export interface WeeklyPlanningExecutorAccessResult {
  allowed: boolean;
  reason: WeeklyPlanningExecutorAccessReason;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function validateWeeklyPlanningSessionCutoverMarker(
  value: unknown,
): value is WeeklyPlanningSessionCutoverMarker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  const keys = Object.keys(marker).sort();
  const expected = [
    'markerVersion',
    'ownerId',
    'conversationId',
    'generation',
    'stableGraphRevision',
    'cutoverAt',
  ].sort();
  if (keys.join('|') !== expected.join('|')) return false;
  if (marker.markerVersion !== WEEKLY_PLANNING_SESSION_CUTOVER_MARKER_VERSION) {
    return false;
  }
  if (!isNonEmptyString(marker.ownerId) || !isNonEmptyString(marker.conversationId)) {
    return false;
  }
  if (marker.generation !== 'legacy' && marker.generation !== 'stable_v5') {
    return false;
  }
  if (!isCanonicalIsoTimestamp(marker.cutoverAt)) return false;
  if (marker.generation === 'legacy') return marker.stableGraphRevision === null;
  return isNonNegativeInteger(marker.stableGraphRevision);
}

export function createWeeklyPlanningSessionCutoverMarker(params: {
  ownerId: string;
  conversationId: string;
  generation: WeeklyPlanningExecutorGeneration;
  stableGraphRevision?: number | null;
  cutoverAt: string;
}): WeeklyPlanningSessionCutoverMarker {
  const marker: WeeklyPlanningSessionCutoverMarker = {
    markerVersion: WEEKLY_PLANNING_SESSION_CUTOVER_MARKER_VERSION,
    ownerId: params.ownerId,
    conversationId: params.conversationId,
    generation: params.generation,
    stableGraphRevision: params.generation === 'stable_v5'
      ? params.stableGraphRevision ?? null
      : null,
    cutoverAt: params.cutoverAt,
  };
  if (!validateWeeklyPlanningSessionCutoverMarker(marker)) {
    throw new Error('Invalid weekly planning session cutover marker.');
  }
  return marker;
}

export function evaluateWeeklyPlanningExecutorReadAccess(params: {
  marker: WeeklyPlanningSessionCutoverMarker;
  ownerId: string;
  conversationId: string;
  executorGeneration: WeeklyPlanningExecutorGeneration;
  stableGraphRevision?: number | null;
}): WeeklyPlanningExecutorAccessResult {
  if (!validateWeeklyPlanningSessionCutoverMarker(params.marker)) {
    return { allowed: false, reason: 'invalid-marker' };
  }
  if (params.marker.ownerId !== params.ownerId) {
    return { allowed: false, reason: 'owner-mismatch' };
  }
  if (params.marker.conversationId !== params.conversationId) {
    return { allowed: false, reason: 'conversation-mismatch' };
  }
  if (params.marker.generation !== params.executorGeneration) {
    return { allowed: false, reason: 'generation-mismatch' };
  }
  if (params.executorGeneration === 'stable_v5'
    && params.marker.stableGraphRevision !== params.stableGraphRevision) {
    return { allowed: false, reason: 'stable-revision-mismatch' };
  }
  return { allowed: true, reason: 'allowed' };
}

export function evaluateWeeklyPlanningExecutorWriteAccess(params: {
  marker: WeeklyPlanningSessionCutoverMarker;
  ownerId: string;
  conversationId: string;
  executorGeneration: WeeklyPlanningExecutorGeneration;
  stableGraphRevision?: number | null;
}): WeeklyPlanningExecutorAccessResult {
  const readAccess = evaluateWeeklyPlanningExecutorReadAccess(params);
  if (!readAccess.allowed) {
    if (params.marker.generation === 'stable_v5'
      && params.executorGeneration === 'legacy') {
      return { allowed: false, reason: 'legacy-write-after-stable-cutover' };
    }
    return readAccess;
  }
  return { allowed: true, reason: 'allowed' };
}
