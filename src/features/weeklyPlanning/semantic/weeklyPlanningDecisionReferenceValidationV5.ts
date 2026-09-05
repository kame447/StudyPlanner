import type {
  SemanticDecisionV5,
  SemanticReferenceV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

function nonEmptyId(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function localReferenceExists(
  document: WeeklyPlanningSemanticDocumentV5,
  kind: SemanticReferenceV5['kind'],
  localId: string,
): boolean {
  if (kind === 'planning_window') return document.planningWindow?.localId === localId;
  if (kind === 'task') return document.tasks.some((task) => task.localId === localId);
  if (kind === 'component') {
    return document.tasks.some((task) =>
      (task.study?.components ?? []).some((component) => component.localId === localId));
  }
  if (kind === 'workload') {
    return document.tasks.some((task) =>
      task.workloads.some((workload) => workload.localId === localId)
      || (task.study?.components ?? []).some((component) =>
        component.workloads.some((workload) => workload.localId === localId)));
  }
  if (kind === 'effort_estimate') {
    return document.tasks.some((task) =>
      task.effortEstimates.some((effort) => effort.localId === localId));
  }
  if (kind === 'temporal_constraint') {
    return document.tasks.some((task) =>
      task.temporalConstraints.some((constraint) => constraint.localId === localId));
  }
  if (kind === 'recurrence') {
    return document.tasks.some((task) =>
      task.recurrence.some((recurrence) => recurrence.localId === localId));
  }
  if (kind === 'relation') {
    return document.relations.some((relation) => relation.localId === localId);
  }
  return false;
}

const PUBLIC_STATE_ARRAY_BY_KIND: Partial<Record<SemanticReferenceV5['kind'], string>> = {
  planning_window: 'planningWindows',
  task: 'tasks',
  component: 'components',
  workload: 'workloads',
  effort_estimate: 'effortEstimates',
  temporal_constraint: 'temporalConstraints',
  recurrence: 'recurrences',
  relation: 'relations',
  proposal: 'learningStrategyProposals',
};

function publicReferenceExists(
  publicStateSummary: Record<string, unknown>,
  kind: SemanticReferenceV5['kind'],
  publicId: string,
): boolean {
  const key = PUBLIC_STATE_ARRAY_BY_KIND[kind];
  if (!key) return false;
  return recordArray(publicStateSummary[key]).some(
    (candidate) => candidate.publicId === publicId,
  );
}

function decisionTargetErrors(
  decision: SemanticDecisionV5,
  index: number,
  document: WeeklyPlanningSemanticDocumentV5,
  publicStateSummary?: Record<string, unknown>,
): string[] {
  const path = `document.decisions[${index}].target`;
  const publicId = nonEmptyId(decision.target.publicId) ? decision.target.publicId : null;
  const localId = nonEmptyId(decision.target.localId) ? decision.target.localId : null;

  if (decision.target.kind === 'proposal') {
    if (!publicId) return [`${path}:proposal-requires-public-id`];
    if (publicStateSummary
      && !publicReferenceExists(publicStateSummary, 'proposal', publicId)) {
      return [`${path}:unknown-active-proposal:${publicId}`];
    }
    return [];
  }

  if (!publicId && !localId) {
    return [`${path}:requires-machine-addressable-id`];
  }

  const errors: string[] = [];
  if (localId && !localReferenceExists(document, decision.target.kind, localId)) {
    errors.push(`${path}:unknown-current-turn-${decision.target.kind}:${localId}`);
  }
  if (publicId && publicStateSummary
    && !publicReferenceExists(publicStateSummary, decision.target.kind, publicId)) {
    errors.push(`${path}:unknown-active-${decision.target.kind}:${publicId}`);
  }
  return errors;
}

export function validateWeeklyPlanningDecisionTargetReferencesV5(
  document: WeeklyPlanningSemanticDocumentV5,
  publicStateSummary?: Record<string, unknown>,
): string[] {
  return document.decisions.flatMap((decision, index) =>
    decisionTargetErrors(decision, index, document, publicStateSummary));
}
