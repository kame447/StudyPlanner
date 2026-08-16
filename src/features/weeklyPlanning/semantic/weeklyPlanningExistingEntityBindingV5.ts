import type {
  SemanticWorkloadV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
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
