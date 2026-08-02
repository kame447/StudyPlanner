import type {
  SemanticTaskV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_TASK_BOUNDARY_CONTRACT_V5 =
  'weekly-planning-task-boundary-contract-v5' as const;

function normalizedLabel(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function independentRootSubjects(task: SemanticTaskV5) {
  return (task.study?.components ?? []).filter((component) =>
    component.parentLocalId === null
    && component.role === 'subject'
    && component.workloads.length > 0);
}

export function taskBoundaryConformanceErrorsV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  const errors: string[] = [];

  for (const task of document.tasks) {
    const subjects = independentRootSubjects(task);
    const uniqueSubjectLabels = new Map<string, string>();
    for (const subject of subjects) {
      const normalized = normalizedLabel(subject.label);
      if (normalized) uniqueSubjectLabels.set(normalized, subject.label.trim());
    }
    if (uniqueSubjectLabels.size < 2) continue;

    const taskTitle = normalizedLabel(task.title);
    if (taskTitle && uniqueSubjectLabels.has(taskTitle)) {
      errors.push(
        `document.tasks.${task.localId}:parent-title-collides-with-subject:${task.title}`,
      );
    }

    if (!task.study?.contextLabel?.trim()) {
      errors.push(
        `document.tasks.${task.localId}:multiple-subjects-require-shared-context:${[
          ...uniqueSubjectLabels.values(),
        ].join('|')}`,
      );
    }
  }

  return errors;
}

export function taskBoundaryInstructionV5(): string {
  return [
    'Use one top-level study task with multiple subject components only when the user explicitly names a shared exam, course, project, or other study context that genuinely contains those subjects; preserve that shared context in study.contextLabel and use a parent task title distinct from every child subject label.',
    'When the user simply coordinates independent activities and gives each its own quantity, such as subject A for one amount and subject B for another amount, create separate top-level tasks rather than sibling subject components under one of those subjects.',
    'Never use one child subject label as the parent task title for multiple sibling subject components.',
  ].join(' ');
}
