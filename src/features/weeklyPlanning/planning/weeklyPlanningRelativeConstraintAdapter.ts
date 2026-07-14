import type { LifeConstraint, PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  resolveRelativeConstraints,
  type RelativeConstraint,
  type RelativeConstraintAnchor,
  type RelativeConstraintResolutionResult,
} from './weeklyPlanningRelativeConstraints';

export interface RelativeConstraintStateResult {
  state: PlanningIntakeState;
  resolution: RelativeConstraintResolutionResult;
}

const KIND_LABELS: Partial<Record<LifeConstraint['kind'], string[]>> = {
  fixed_event: ['予定', 'バイト', '授業', 'ゼミ', '通院'],
  cram_school: ['塾', '予備校'],
  club: ['部活', 'サークル'],
  meal: ['食事', '夕食', '昼食', '朝食'],
  commute: ['移動', '帰宅', '通学'],
};

function revision(state: PlanningIntakeState): number {
  return state.sourceTurns.length;
}

function constraintAnchor(
  constraint: LifeConstraint,
  index: number,
  stateRevision: number,
): RelativeConstraintAnchor | null {
  if (!constraint.date || !constraint.start || !constraint.end) return null;
  return {
    factRef: `constraint:${index}`,
    eventId: `constraint-event:${index}`,
    date: constraint.date,
    startTime: constraint.start,
    endTime: constraint.end,
    visibility: 'public',
    stateRevision,
    sourceFactRefs: [`constraint:${index}`],
  };
}

function labelMatches(text: string, constraint: LifeConstraint): boolean {
  const labels = [constraint.rawText ?? '', ...(KIND_LABELS[constraint.kind] ?? [])]
    .filter((label) => label.trim().length > 0);
  return labels.some((label) => text.includes(label));
}

function matchingAnchorIndex(state: PlanningIntakeState, text: string): number | null {
  const matches = state.constraints.flatMap((constraint, index) =>
    constraintAnchor(constraint, index, revision(state)) && labelMatches(text, constraint) ? [index] : [],
  );
  return matches.length === 1 ? matches[0] : null;
}

function relationId(state: PlanningIntakeState, index: number, kind: string): string {
  return `relative:${revision(state)}:${index}:${kind}`;
}

function deriveRelativeConstraint(
  state: PlanningIntakeState,
  userText: string,
): RelativeConstraint | null {
  const index = matchingAnchorIndex(state, userText);
  if (index === null) return null;
  const anchorFactRef = `constraint:${index}`;
  const buffer = /前後\s*(\d+)\s*分/.exec(userText);
  if (buffer) {
    return {
      relationId: relationId(state, index, 'buffer'),
      anchorFactRef,
      relation: 'during_buffer',
      offsetMinutes: Number(buffer[1]),
      sourceFactRefs: [anchorFactRef, `turn:${revision(state)}`],
      stateRevision: revision(state),
      confidence: 'high',
    };
  }
  const afterDuration = /(?:後|あと).*?(?:帰宅|移動)?\s*(\d+)\s*分/.exec(userText)
    ?? /(?:帰宅|移動)\s*(\d+)\s*分/.exec(userText);
  if (afterDuration && /(?:後|あと|帰宅|移動)/.test(userText)) {
    return {
      relationId: relationId(state, index, 'after'),
      anchorFactRef,
      relation: 'after',
      offsetMinutes: 0,
      durationMinutes: Number(afterDuration[1]),
      sourceFactRefs: [anchorFactRef, `turn:${revision(state)}`],
      stateRevision: revision(state),
      confidence: 'high',
    };
  }
  const before = /(?:前に|前の)\s*(\d+)\s*分/.exec(userText);
  if (before) {
    return {
      relationId: relationId(state, index, 'before'),
      anchorFactRef,
      relation: 'before',
      offsetMinutes: 0,
      durationMinutes: Number(before[1]),
      sourceFactRefs: [anchorFactRef, `turn:${revision(state)}`],
      stateRevision: revision(state),
      confidence: 'high',
    };
  }
  return null;
}

function toLifeConstraint(
  relation: RelativeConstraint,
  resolved: RelativeConstraintResolutionResult['resolved'][number],
  sourceText: string,
): LifeConstraint {
  const isMovement = relation.relation === 'after' && /帰宅|移動|通学/.test(sourceText);
  return {
    kind: isMovement ? 'commute' : 'buffer',
    date: resolved.date,
    start: resolved.startTime,
    end: resolved.endTime,
    hardness: relation.relation === 'during_buffer' ? 'hard' : 'soft',
    rawText: `relative-constraint:${relation.relationId}:${sourceText}`,
  };
}

export function applyRelativeConstraintTurn(params: {
  state: PlanningIntakeState;
  userText: string;
}): RelativeConstraintStateResult {
  const relation = deriveRelativeConstraint(params.state, params.userText);
  const anchors = params.state.constraints.flatMap((constraint, index) => {
    const anchor = constraintAnchor(constraint, index, revision(params.state));
    return anchor ? [anchor] : [];
  });
  if (!relation) {
    return {
      state: params.state,
      resolution: { resolved: [], rejected: [], conflicts: [] },
    };
  }
  const resolution = resolveRelativeConstraints({
    constraints: [relation],
    anchors,
    currentStateRevision: revision(params.state),
    busyIntervals: params.state.constraints.flatMap((constraint, index) =>
      constraint.date && constraint.start && constraint.end
        ? [{ ref: `constraint:${index}`, date: constraint.date, startTime: constraint.start, endTime: constraint.end }]
        : [],
    ),
  });
  const additions = resolution.resolved.map((resolved) => toLifeConstraint(relation, resolved, params.userText));
  if (additions.length === 0) return { state: params.state, resolution };
  const existingRawTexts = new Set(params.state.constraints.map((constraint) => constraint.rawText));
  return {
    state: {
      ...params.state,
      constraints: [
        ...params.state.constraints,
        ...additions.filter((constraint) => !existingRawTexts.has(constraint.rawText)),
      ],
    },
    resolution,
  };
}
