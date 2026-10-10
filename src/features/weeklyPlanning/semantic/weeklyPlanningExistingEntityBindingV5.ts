import type {
  SemanticWorkloadV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningPendingQuestionV5 } from './weeklyPlanningPendingQuestionV5';
import type {
  WeeklyPlanningFactGraphV5,
  WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  isWeeklyPlanningMachineContextualValidationEnvelopeV5,
} from './weeklyPlanningContextualValidationBoundaryV5';

export const WEEKLY_PLANNING_EXISTING_ENTITY_BINDING_VERSION_V5 =
  'weekly-planning-existing-entity-binding-v5' as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalized(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  publicStateSummary?: Record<string, unknown>;
}): string[] {
  const state = params.publicStateSummary;
  if (!state) return [];
  if (isWeeklyPlanningMachineContextualValidationEnvelopeV5(params)) return [];

  const publicTasks = recordArray(state.tasks);
  const publicComponents = recordArray(state.components);
  const errors: string[] = [];

  for (const [taskIndex, task] of params.document.tasks.entries()) {
    const taskPath = `document.tasks[${taskIndex}]`;
    const boundTask = task.existingPublicId
      ? publicTasks.find((candidate) => candidate.publicId === task.existingPublicId)
      : null;
    if (task.existingPublicId && !boundTask) {
      errors.push(`${taskPath}.existingPublicId:unknown-active-task:${task.existingPublicId}`);
    }
    if (!task.existingPublicId) {
      const candidates = publicTasks.filter((candidate) =>
        typeof candidate.title === 'string'
        && normalized(candidate.title) === normalized(task.title)
        && candidate.category === task.category
        && typeof candidate.publicId === 'string');
      if (candidates.length > 0) {
        errors.push(
          `${taskPath}.existingPublicId:existing-task-binding-required:candidates=${candidates.map((candidate) => candidate.publicId).join(',')}`,
        );
      }
    }

    for (const [componentIndex, component] of (task.study?.components ?? []).entries()) {
      const path = `${taskPath}.study.components[${componentIndex}]`;
      if (component.existingPublicId) {
        const boundComponent = publicComponents.find(
          (candidate) => candidate.publicId === component.existingPublicId,
        );
        if (!boundComponent) {
          errors.push(`${path}.existingPublicId:unknown-active-component:${component.existingPublicId}`);
          continue;
        }
        if (!task.existingPublicId) {
          errors.push(`${path}.existingPublicId:existing-component-requires-existing-task-binding`);
        } else if (boundComponent.taskPublicId !== task.existingPublicId) {
          errors.push(`${path}.existingPublicId:component-task-binding-mismatch`);
        }
      } else if (task.existingPublicId) {
        const candidates = publicComponents.filter((candidate) =>
          candidate.taskPublicId === task.existingPublicId
          && candidate.role === component.role
          && typeof candidate.label === 'string'
          && normalized(candidate.label) === normalized(component.label)
          && typeof candidate.publicId === 'string');
        if (candidates.length > 0) {
          errors.push(
            `${path}.existingPublicId:existing-component-binding-required:candidates=${candidates.map((candidate) => candidate.publicId).join(',')}`,
          );
        }
      }
    }
  }
  return errors;
}

export interface WeeklyPlanningExistingEntityGraphBindingsV5 {
  taskFactIdByLocalId: Record<string, string>;
  componentFactIdByLocalId: Record<string, string>;
  workloadFactIdByLocalId: Record<string, string>;
  errors: string[];
}

function sameWorkloadShape(
  semantic: SemanticWorkloadV5,
  fact: WorkloadFactV5,
): boolean {
  return semantic.quantityRole === fact.quantityRole
    && semantic.amount === fact.amount
    && semantic.rangeStart === fact.rangeStart
    && semantic.rangeEnd === fact.rangeEnd
    && semantic.perOccurrence === fact.perOccurrence
    && semantic.periodExpression === fact.periodExpression;
}

function exactUnitMatch(
  semantic: SemanticWorkloadV5,
  fact: WorkloadFactV5,
): boolean {
  return semantic.unitCode === fact.unitCode;
}

function safeCustomUnitLabelFallback(
  semantic: SemanticWorkloadV5,
  fact: WorkloadFactV5,
): boolean {
  return (semantic.unitCode === 'custom' || fact.unitCode === 'custom')
    && normalized(semantic.unitLabel) === normalized(fact.unitLabel);
}

function workloadCandidates(params: {
  semantic: SemanticWorkloadV5;
  taskId: string;
  componentId: string | null;
  activeWorkloads: readonly WorkloadFactV5[];
}): WorkloadFactV5[] {
  const structural = params.activeWorkloads.filter((candidate) =>
    candidate.taskId === params.taskId
    && candidate.componentId === params.componentId
    && sameWorkloadShape(params.semantic, candidate));
  const exact = structural.filter((candidate) => exactUnitMatch(params.semantic, candidate));
  if (exact.length > 0) return exact;
  return structural.filter((candidate) => safeCustomUnitLabelFallback(params.semantic, candidate));
}

export function resolveWeeklyPlanningExistingEntityGraphBindingsV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  graph: WeeklyPlanningFactGraphV5;
}): WeeklyPlanningExistingEntityGraphBindingsV5 {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  const tasks = new Map(active.tasks.map((task) => [task.id, task]));
  const components = new Map(active.components.map((component) => [component.id, component]));
  const workloads = new Map(active.workloads.map((workload) => [workload.id, workload]));
  const taskFactIdByLocalId: Record<string, string> = {};
  const componentFactIdByLocalId: Record<string, string> = {};
  const workloadFactIdByLocalId: Record<string, string> = {};
  const boundFactIds = new Set<string>();
  const errors: string[] = [];

  for (const task of params.document.tasks) {
    if (!task.existingPublicId) continue;
    if (!tasks.has(task.existingPublicId)) {
      errors.push(`existing-task-binding-not-active:${task.localId}:${task.existingPublicId}`);
      continue;
    }
    if (boundFactIds.has(task.existingPublicId)) {
      errors.push(`existing-fact-bound-twice:${task.existingPublicId}`);
      continue;
    }
    boundFactIds.add(task.existingPublicId);
    taskFactIdByLocalId[task.localId] = task.existingPublicId;
  }

  for (const task of params.document.tasks) {
    const resolvedTaskId = taskFactIdByLocalId[task.localId] ?? null;
    for (const component of task.study?.components ?? []) {
      if (!component.existingPublicId) continue;
      const fact = components.get(component.existingPublicId);
      if (!fact) {
        errors.push(`existing-component-binding-not-active:${component.localId}:${component.existingPublicId}`);
        continue;
      }
      if (!resolvedTaskId) {
        errors.push(`existing-component-binding-with-new-task:${component.localId}`);
        continue;
      }
      if (fact.taskId !== resolvedTaskId) {
        errors.push(`existing-component-binding-task-mismatch:${component.localId}:${component.existingPublicId}`);
        continue;
      }
      if (boundFactIds.has(component.existingPublicId)) {
        errors.push(`existing-fact-bound-twice:${component.existingPublicId}`);
        continue;
      }
      boundFactIds.add(component.existingPublicId);
      componentFactIdByLocalId[component.localId] = component.existingPublicId;
    }
  }

  const bindWorkload = (paramsForWorkload: {
    semantic: SemanticWorkloadV5;
    taskId: string | null;
    componentId: string | null;
  }): void => {
    if (!paramsForWorkload.taskId) return;
    const exactIdCandidate = workloads.get(paramsForWorkload.semantic.localId);
    const exactIdMatches = exactIdCandidate
      && exactIdCandidate.taskId === paramsForWorkload.taskId
      && exactIdCandidate.componentId === paramsForWorkload.componentId
      && sameWorkloadShape(paramsForWorkload.semantic, exactIdCandidate)
      && (
        exactUnitMatch(paramsForWorkload.semantic, exactIdCandidate)
        || safeCustomUnitLabelFallback(paramsForWorkload.semantic, exactIdCandidate)
      );
    const candidates = exactIdMatches
      ? [exactIdCandidate]
      : workloadCandidates({
          semantic: paramsForWorkload.semantic,
          taskId: paramsForWorkload.taskId,
          componentId: paramsForWorkload.componentId,
          activeWorkloads: active.workloads,
        });
    if (candidates.length === 0) return;
    if (candidates.length > 1) {
      errors.push(
        `existing-workload-binding-ambiguous:${paramsForWorkload.semantic.localId}:${candidates.map((candidate) => candidate.id).join(',')}`,
      );
      return;
    }
    const candidate = candidates[0];
    if (boundFactIds.has(candidate.id)) {
      errors.push(`existing-fact-bound-twice:${candidate.id}`);
      return;
    }
    boundFactIds.add(candidate.id);
    workloadFactIdByLocalId[paramsForWorkload.semantic.localId] = candidate.id;
  };

  for (const task of params.document.tasks) {
    const resolvedTaskId = taskFactIdByLocalId[task.localId] ?? null;
    for (const workload of task.workloads) {
      bindWorkload({ semantic: workload, taskId: resolvedTaskId, componentId: null });
    }
    for (const component of task.study?.components ?? []) {
      const resolvedComponentId = componentFactIdByLocalId[component.localId] ?? null;
      for (const workload of component.workloads) {
        bindWorkload({
          semantic: workload,
          taskId: resolvedTaskId,
          componentId: resolvedComponentId,
        });
      }
    }
  }

  return {
    taskFactIdByLocalId,
    componentFactIdByLocalId,
    workloadFactIdByLocalId,
    errors,
  };
}

/** Only a complete single-answer restatement may retain contextual projection.
 * Extra declarations or semantic payload require ordinary canonicalization. */
function isSingleWorkloadEffortRestatement(document: WeeklyPlanningSemanticDocumentV5): boolean {
  if (document.planningIntent !== 'update_plan' || document.planningWindow !== null
    || document.tasks.length !== 1 || document.relations.length > 0
    || document.availabilityDeclarations.length > 0 || document.constraintSourceRequests.length > 0
    || (document.userContextFacts?.length ?? 0) > 0 || document.uncertainties.length > 0
    || document.corrections.length > 0 || document.decisions.length > 0) return false;
  const task = document.tasks[0];
  if (task.effortEstimates.length !== 1 || task.temporalConstraints.length > 0
    || task.recurrence.length > 0 || (task.durableContextSignals?.length ?? 0) > 0
    || (task.decompositionStatus !== undefined && task.decompositionStatus !== 'atomic')) return false;
  if (!task.study) return task.workloads.length === 1;
  // Existing-task normalization may fill a neutral unknown study wrapper.
  if (task.study.purpose !== 'unknown' || task.study.contextLabel !== null
    || (task.study.activityKind !== undefined && task.study.activityKind !== 'unknown')) return false;
  if (task.study.components.length === 0) return task.workloads.length === 1;
  if (task.workloads.length !== 0 || task.study.components.length !== 1) return false;
  const component = task.study.components[0];
  return typeof component.existingPublicId === 'string' && component.existingPublicId.length > 0
    && component.parentLocalId === null && component.workloads.length === 1
    && (component.durableContextSignals?.length ?? 0) === 0;
}

/** Explicit local efforts require ordinary binding unless that same formal owner
 * proves a single pending answer would preserve its target, kind and unit exactly.
 * New/ambiguous/invalid bindings and independent payload never authorize a guess. */
export function requiresWeeklyPlanningExplicitLocalWorkloadEffortBindingV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  graph: WeeklyPlanningFactGraphV5;
  pendingQuestion: Pick<WeeklyPlanningPendingQuestionV5, 'targetFactId' | 'effortMeasurement'>;
}): boolean {
  const { document, graph, pendingQuestion } = params;
  const qualified = document.tasks.flatMap(task => {
    if (typeof task.existingPublicId !== 'string' || task.existingPublicId.length === 0) return [];
    const localWorkloadIds = new Set([
      ...task.workloads,
      ...(task.study?.components ?? []).flatMap(component => component.workloads),
    ].map(workload => workload.localId));
    return task.effortEstimates.filter(estimate =>
      (estimate.kind === 'total_duration' || estimate.kind === 'session_duration')
      && localWorkloadIds.has(estimate.targetLocalId)).map(estimate => ({ task, estimate }));
  });
  if (qualified.length === 0) return false;
  if (!isSingleWorkloadEffortRestatement(document)) return true;
  const bindings = resolveWeeklyPlanningExistingEntityGraphBindingsV5({ document, graph });
  if (bindings.errors.length > 0) return true;
  return qualified.some(({ task, estimate }) => {
    const id = bindings.workloadFactIdByLocalId[estimate.targetLocalId];
    const target = graph.workloads.find(workload => workload.id === id);
    return !target || bindings.taskFactIdByLocalId[task.localId] !== target.taskId
      || target.id !== pendingQuestion.targetFactId || estimate.kind !== pendingQuestion.effortMeasurement
      || estimate.unitCode !== (pendingQuestion.effortMeasurement === 'total_duration' ? null : target.unitCode);
  });
}

/** Reserve every local-ID token before representation cleanup can remove it. */
export function collectWeeklyPlanningLocalReferenceTokensV5(value: unknown): Set<string> {
  const ids = new Set<string>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (Array.isArray(entry)) pending.push(...entry);
    else if (isRecord(entry)) {
      for (const [key, child] of Object.entries(entry)) {
        if (key === 'localId' && typeof child === 'string') ids.add(child);
        else pending.push(child);
      }
    }
  }
  return ids;
}

/**
 * Resolve only an explicit external workload reference in this document.
 * Local tokens always win; diagnostics and pending questions are not authority.
 */
export function resolveWeeklyPlanningExactWorkloadEffortTargetV5(params: {
  document: unknown;
  task: unknown;
  estimate: unknown;
  graph: WeeklyPlanningFactGraphV5;
  blockedLocalIds?: ReadonlySet<string>;
}): WorkloadFactV5 | null {
  const { task, estimate, graph } = params;
  if (!isRecord(task) || !isRecord(estimate)
    || typeof task.existingPublicId !== 'string'
    || typeof estimate.targetLocalId !== 'string'
    || (estimate.kind !== 'total_duration' && estimate.kind !== 'session_duration')
    || params.blockedLocalIds?.has(estimate.targetLocalId)
    || collectWeeklyPlanningLocalReferenceTokensV5(params.document).has(estimate.targetLocalId)) return null;

  // The new external-reference path requires explicit active lifecycle entries.
  const active = new Set(graph.factLifecycles?.filter(entry => entry.status === 'active')
    .map(entry => entry.factId) ?? []);
  const owner = graph.tasks.find(candidate => candidate.id === task.existingPublicId);
  if (!owner || !active.has(owner.id)) return null;
  const workload = graph.workloads.find(candidate => candidate.id === estimate.targetLocalId);
  if (!workload || workload.taskId !== owner.id || !active.has(workload.id)) return null;
  if (workload.componentId !== null) {
    const component = graph.components.find(candidate => candidate.id === workload.componentId);
    if (!component || component.taskId !== owner.id || !active.has(component.id)) return null;
  }
  return workload;
}
