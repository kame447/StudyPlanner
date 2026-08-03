import type {
  SemanticStudyComponentV5,
  SemanticTaskV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_TASK_BOUNDARY_CONTRACT_V5 =
  'weekly-planning-task-boundary-contract-v5' as const;

export interface TaskBoundaryNormalizationV5 {
  document: WeeklyPlanningSemanticDocumentV5;
  repairs: string[];
}

function normalizedLabel(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function quantifiedRootComponents(task: SemanticTaskV5): SemanticStudyComponentV5[] {
  return (task.study?.components ?? []).filter((component) =>
    component.parentLocalId === null && component.workloads.length > 0);
}

function collidingRootComponent(
  task: SemanticTaskV5,
): SemanticStudyComponentV5 | null {
  const taskTitle = normalizedLabel(task.title);
  if (!taskTitle) return null;
  return quantifiedRootComponents(task).find(
    (component) => normalizedLabel(component.label) === taskTitle,
  ) ?? null;
}

function hasDistinctSharedContext(task: SemanticTaskV5): boolean {
  const context = normalizedLabel(task.study?.contextLabel ?? '');
  if (!context) return false;
  return quantifiedRootComponents(task).every(
    (component) => normalizedLabel(component.label) !== context,
  );
}

function referencesTask(
  document: WeeklyPlanningSemanticDocumentV5,
  taskId: string,
): boolean {
  return document.relations.some(
    (relation) => relation.fromLocalId === taskId || relation.toLocalId === taskId,
  ) || document.corrections.some(
    (correction) => correction.target.localId === taskId,
  ) || document.decisions.some(
    (decision) => decision.target.localId === taskId,
  );
}

function canSplitTask(
  document: WeeklyPlanningSemanticDocumentV5,
  task: SemanticTaskV5,
): boolean {
  return Boolean(task.study)
    && quantifiedRootComponents(task).length >= 2
    && task.workloads.length === 0
    && task.effortEstimates.length === 0
    && task.temporalConstraints.length === 0
    && task.recurrence.length === 0
    && !referencesTask(document, task.localId);
}

function collectLocalIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectLocalIds(entry, ids));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.localId === 'string') ids.add(record.localId);
  Object.values(record).forEach((entry) => collectLocalIds(entry, ids));
}

function uniqueTaskId(base: string, usedIds: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function componentsForRoot(
  components: SemanticStudyComponentV5[],
  rootId: string,
): SemanticStudyComponentV5[] {
  const byId = new Map(components.map((component) => [component.localId, component]));

  return components.filter((component) => {
    let current: SemanticStudyComponentV5 | undefined = component;
    const visited = new Set<string>();
    while (current) {
      if (current.localId === rootId) return true;
      if (!current.parentLocalId || visited.has(current.localId)) return false;
      visited.add(current.localId);
      current = byId.get(current.parentLocalId);
    }
    return false;
  });
}

function splitTaskByQuantifiedRoots(
  task: SemanticTaskV5,
  usedIds: Set<string>,
): SemanticTaskV5[] {
  if (!task.study) return [task];
  const roots = quantifiedRootComponents(task);

  return roots.map((root) => ({
    localId: uniqueTaskId(`${task.localId}--${root.localId}`, usedIds),
    category: task.category,
    title: root.label,
    study: {
      purpose: task.study?.purpose ?? 'unknown',
      contextLabel: null,
      components: componentsForRoot(task.study?.components ?? [], root.localId),
    },
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: root.sourceText,
  }));
}

export function normalizeTaskBoundariesV5(
  document: WeeklyPlanningSemanticDocumentV5,
): TaskBoundaryNormalizationV5 {
  const usedIds = new Set<string>();
  collectLocalIds(document, usedIds);
  const repairs: string[] = [];
  const tasks: SemanticTaskV5[] = [];

  for (const task of document.tasks) {
    const colliding = collidingRootComponent(task);
    if (!colliding || quantifiedRootComponents(task).length < 2) {
      tasks.push(task);
      continue;
    }

    if (hasDistinctSharedContext(task)) {
      const title = task.study?.contextLabel?.trim() ?? task.title;
      tasks.push({ ...task, title });
      repairs.push(`task-parent-renamed-to-shared-context:${task.localId}`);
      continue;
    }

    if (canSplitTask(document, task)) {
      tasks.push(...splitTaskByQuantifiedRoots(task, usedIds));
      repairs.push(`task-container-split-by-independent-roots:${task.localId}`);
      continue;
    }

    tasks.push(task);
  }

  return {
    document: tasks === document.tasks ? document : { ...document, tasks },
    repairs,
  };
}

export function taskBoundaryConformanceErrorsV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  const errors: string[] = [];

  for (const task of document.tasks) {
    const roots = quantifiedRootComponents(task);
    const colliding = collidingRootComponent(task);
    if (roots.length < 2 || !colliding) continue;

    errors.push(
      `document.tasks.${task.localId}:parent-title-collides-with-child:${colliding.label}`,
    );
  }

  return errors;
}
