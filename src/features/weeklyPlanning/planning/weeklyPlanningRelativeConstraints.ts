import type { PlanningConfidence } from './weeklyPlanningBehaviorTypes';

export type RelativeRelationKind = 'before' | 'after' | 'during_buffer';

export interface RelativeConstraint {
  relationId: string;
  anchorFactRef: string;
  relation: RelativeRelationKind;
  offsetMinutes: number;
  durationMinutes?: number;
  sourceFactRefs: string[];
  stateRevision: number;
  confidence: PlanningConfidence;
}

export interface RelativeConstraintAnchor {
  factRef: string;
  eventId: string;
  date: string;
  startTime: string;
  endTime: string;
  visibility: 'public' | 'private';
  stateRevision: number;
  sourceFactRefs: string[];
}

export interface ResolvedRelativeConstraint {
  relationId: string;
  anchorEventId: string;
  date: string;
  startTime: string;
  endTime: string;
  sourceFactRefs: string[];
  stateRevision: number;
}

export interface RelativeConstraintConflict {
  relationId: string;
  conflictRef: string;
  reason: 'overlap';
}

export type RelativeConstraintValidationResult =
  | { accepted: true; constraint: RelativeConstraint; anchor: RelativeConstraintAnchor }
  | { accepted: false; reason: string };

export interface RelativeConstraintResolutionResult {
  resolved: ResolvedRelativeConstraint[];
  rejected: Array<{ constraint: RelativeConstraint; reason: string }>;
  conflicts: RelativeConstraintConflict[];
}

function validIdentifier(value: string): boolean {
  return value.trim().length > 0 && value.length <= 200;
}

function parseTime(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTime(value: number): string {
  const normalized = Math.max(0, Math.min(24 * 60 - 1, Math.round(value)));
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(new Date(`${value}T00:00:00`).getTime());
}

function cloneConstraint(constraint: RelativeConstraint): RelativeConstraint {
  return { ...constraint, sourceFactRefs: [...constraint.sourceFactRefs] };
}

function cloneAnchor(anchor: RelativeConstraintAnchor): RelativeConstraintAnchor {
  return { ...anchor, sourceFactRefs: [...anchor.sourceFactRefs] };
}

function relationGraphHasCycle(
  relation: RelativeConstraint,
  existingRelations: readonly RelativeConstraint[],
): boolean {
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string) => {
    const targets = adjacency.get(from) ?? new Set<string>();
    targets.add(to);
    adjacency.set(from, targets);
  };
  [...existingRelations, relation].forEach((item) => addEdge(item.relationId, item.anchorFactRef));

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const target of adjacency.get(node) ?? []) {
      if (adjacency.has(target) && visit(target)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return Array.from(adjacency.keys()).some(visit);
}

export function validateRelativeConstraint(params: {
  value: RelativeConstraint;
  anchors: readonly RelativeConstraintAnchor[];
  existingRelations?: readonly RelativeConstraint[];
  currentStateRevision: number;
}): RelativeConstraintValidationResult {
  const value = params.value;
  if (!validIdentifier(value.relationId)
    || !validIdentifier(value.anchorFactRef)
    || value.relationId === value.anchorFactRef
    || !['before', 'after', 'during_buffer'].includes(value.relation)
    || !Number.isInteger(value.offsetMinutes)
    || value.offsetMinutes < 0
    || value.offsetMinutes > 24 * 60
    || (value.durationMinutes !== undefined
      && (!Number.isInteger(value.durationMinutes)
        || value.durationMinutes <= 0
        || value.durationMinutes > 24 * 60))
    || !Number.isInteger(value.stateRevision)
    || value.stateRevision !== params.currentStateRevision
    || value.sourceFactRefs.length === 0
    || value.sourceFactRefs.length > 8
    || value.sourceFactRefs.some((ref) => !validIdentifier(ref))) {
    return { accepted: false, reason: 'invalid-relative-constraint' };
  }
  const matchingAnchors = params.anchors.filter((anchor) => anchor.factRef === value.anchorFactRef);
  if (matchingAnchors.length !== 1) {
    return { accepted: false, reason: matchingAnchors.length === 0 ? 'unknown-anchor' : 'ambiguous-anchor' };
  }
  const anchor = matchingAnchors[0];
  if (anchor.visibility !== 'public') return { accepted: false, reason: 'private-anchor' };
  if (anchor.stateRevision !== params.currentStateRevision) {
    return { accepted: false, reason: 'stale-anchor' };
  }
  if (!isDate(anchor.date)
    || parseTime(anchor.startTime) === null
    || parseTime(anchor.endTime) === null
    || anchor.sourceFactRefs.length === 0) {
    return { accepted: false, reason: 'invalid-anchor' };
  }
  if (relationGraphHasCycle(value, params.existingRelations ?? [])) {
    return { accepted: false, reason: 'relative-constraint-cycle' };
  }
  return { accepted: true, constraint: cloneConstraint(value), anchor: cloneAnchor(anchor) };
}

export function resolveRelativeConstraint(
  validation: RelativeConstraintValidationResult,
): ResolvedRelativeConstraint | null {
  if (!validation.accepted) return null;
  const { constraint, anchor } = validation;
  const anchorStart = parseTime(anchor.startTime) as number;
  const anchorEnd = parseTime(anchor.endTime) as number;
  const duration = constraint.durationMinutes ?? Math.max(1, anchorEnd - anchorStart);
  let startMinutes: number;
  let endMinutes: number;

  if (constraint.relation === 'before') {
    endMinutes = anchorStart - constraint.offsetMinutes;
    startMinutes = endMinutes - duration;
  } else if (constraint.relation === 'after') {
    startMinutes = anchorEnd + constraint.offsetMinutes;
    endMinutes = startMinutes + duration;
  } else {
    startMinutes = anchorStart - constraint.offsetMinutes;
    endMinutes = anchorEnd + constraint.offsetMinutes;
  }

  if (startMinutes < 0 || endMinutes >= 24 * 60 || endMinutes <= startMinutes) return null;
  return {
    relationId: constraint.relationId,
    anchorEventId: anchor.eventId,
    date: anchor.date,
    startTime: formatTime(startMinutes),
    endTime: formatTime(endMinutes),
    sourceFactRefs: Array.from(new Set([
      ...constraint.sourceFactRefs,
      anchor.factRef,
      ...anchor.sourceFactRefs,
    ])).sort(),
    stateRevision: constraint.stateRevision,
  };
}

function overlaps(
  left: ResolvedRelativeConstraint,
  right: { date: string; startTime: string; endTime: string },
): boolean {
  if (left.date !== right.date) return false;
  const leftStart = parseTime(left.startTime) as number;
  const leftEnd = parseTime(left.endTime) as number;
  const rightStart = parseTime(right.startTime);
  const rightEnd = parseTime(right.endTime);
  return rightStart !== null && rightEnd !== null && leftStart < rightEnd && rightStart < leftEnd;
}

export function resolveRelativeConstraints(params: {
  constraints: readonly RelativeConstraint[];
  anchors: readonly RelativeConstraintAnchor[];
  currentStateRevision: number;
  busyIntervals?: readonly Array<{ ref: string; date: string; startTime: string; endTime: string }>;
}): RelativeConstraintResolutionResult {
  const resolved: ResolvedRelativeConstraint[] = [];
  const rejected: Array<{ constraint: RelativeConstraint; reason: string }> = [];
  const conflicts: RelativeConstraintConflict[] = [];
  const acceptedRelations: RelativeConstraint[] = [];

  params.constraints.forEach((constraint) => {
    const validation = validateRelativeConstraint({
      value: constraint,
      anchors: params.anchors,
      existingRelations: acceptedRelations,
      currentStateRevision: params.currentStateRevision,
    });
    if (!validation.accepted) {
      rejected.push({ constraint: cloneConstraint(constraint), reason: validation.reason });
      return;
    }
    const resolution = resolveRelativeConstraint(validation);
    if (!resolution) {
      rejected.push({ constraint: cloneConstraint(constraint), reason: 'relative-constraint-out-of-bounds' });
      return;
    }
    acceptedRelations.push(cloneConstraint(constraint));
    resolved.push(resolution);
    (params.busyIntervals ?? []).forEach((busy) => {
      if (overlaps(resolution, busy)) {
        conflicts.push({ relationId: constraint.relationId, conflictRef: busy.ref, reason: 'overlap' });
      }
    });
  });

  return { resolved, rejected, conflicts };
}
