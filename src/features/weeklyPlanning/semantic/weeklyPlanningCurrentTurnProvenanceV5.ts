import type {
  SemanticStudyComponentV5,
  SemanticTaskV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_CURRENT_TURN_PROVENANCE_VERSION_V5 =
  'weekly-planning-current-turn-provenance-v5' as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizedEvidenceText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function sourceTextGroundedInCurrentTurn(
  sourceText: string,
  currentUserText: string,
): boolean {
  const normalizedSource = normalizedEvidenceText(sourceText);
  const normalizedCurrent = normalizedEvidenceText(currentUserText);
  return normalizedSource.length > 0 && normalizedCurrent.includes(normalizedSource);
}

function boundRecord(
  publicStateSummary: Record<string, unknown> | undefined,
  key: 'tasks' | 'components',
  publicId: string,
): Record<string, unknown> | null {
  const candidates = recordArray(publicStateSummary?.[key]);
  return candidates.find((candidate) => candidate.publicId === publicId) ?? null;
}

function taskShellNeedsCurrentTurnEvidence(
  task: SemanticTaskV5,
  publicStateSummary: Record<string, unknown> | undefined,
): boolean {
  if (!task.existingPublicId) return true;
  const bound = boundRecord(publicStateSummary, 'tasks', task.existingPublicId);
  if (!bound) return false;

  const titleChanged = typeof bound.title === 'string'
    && normalizedEvidenceText(bound.title) !== normalizedEvidenceText(task.title);
  const categoryChanged = typeof bound.category === 'string'
    && bound.category !== task.category;
  return titleChanged || categoryChanged;
}

function componentShellNeedsCurrentTurnEvidence(
  component: SemanticStudyComponentV5,
  publicStateSummary: Record<string, unknown> | undefined,
): boolean {
  if (!component.existingPublicId) return true;
  const bound = boundRecord(publicStateSummary, 'components', component.existingPublicId);
  if (!bound) return false;

  const labelChanged = typeof bound.label === 'string'
    && normalizedEvidenceText(bound.label) !== normalizedEvidenceText(component.label);
  const roleChanged = typeof bound.role === 'string'
    && bound.role !== component.role;
  return labelChanged || roleChanged;
}

function collectStoredContextStrings(
  publicStateSummary: Record<string, unknown> | undefined,
): Set<string> {
  const stored = new Set<string>();
  const register = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const normalized = normalizedEvidenceText(value);
    if (normalized) stored.add(normalized);
  };

  recordArray(publicStateSummary?.tasks).forEach((task) => register(task.title));
  recordArray(publicStateSummary?.components).forEach((component) => register(component.label));
  recordArray(publicStateSummary?.uncertainties).forEach((uncertainty) => {
    register(uncertainty.reason);
    register(uncertainty.sourceText);
  });
  recordArray(publicStateSummary?.userPlanningContext).forEach((fact) => {
    register(fact.label);
    register(fact.value);
  });
  register(publicStateSummary?.lastAssistantMessage);
  return stored;
}

function contextualMachineBoundEntityValues(
  publicStateSummary: Record<string, unknown> | undefined,
): {
  taskTitles: Set<string>;
  componentLabels: Set<string>;
} {
  const taskTitles = new Set<string>();
  const componentLabels = new Set<string>();
  if (!publicStateSummary) return { taskTitles, componentLabels };

  const pendingQuestion = isRecord(publicStateSummary.pendingQuestion)
    ? publicStateSummary.pendingQuestion
    : null;
  const targetFactId = typeof pendingQuestion?.targetFactId === 'string'
    ? pendingQuestion.targetFactId
    : null;
  if (!targetFactId) return { taskTitles, componentLabels };

  const tasks = recordArray(publicStateSummary.tasks);
  const components = recordArray(publicStateSummary.components);
  const workloads = recordArray(publicStateSummary.workloads);
  const targetWorkload = workloads.find((workload) => workload.publicId === targetFactId) ?? null;
  const targetComponent = components.find((component) => component.publicId === targetFactId) ?? null;
  const targetTask = tasks.find((task) => task.publicId === targetFactId) ?? null;

  const taskPublicId = typeof targetWorkload?.taskPublicId === 'string'
    ? targetWorkload.taskPublicId
    : typeof targetComponent?.taskPublicId === 'string'
      ? targetComponent.taskPublicId
      : typeof targetTask?.publicId === 'string'
        ? targetTask.publicId
        : null;
  const componentPublicId = typeof targetWorkload?.componentPublicId === 'string'
    ? targetWorkload.componentPublicId
    : typeof targetComponent?.publicId === 'string'
      ? targetComponent.publicId
      : null;

  const task = taskPublicId
    ? tasks.find((candidate) => candidate.publicId === taskPublicId) ?? null
    : null;
  if (typeof task?.title === 'string') {
    taskTitles.add(normalizedEvidenceText(task.title));
  }

  const component = componentPublicId
    ? components.find((candidate) => candidate.publicId === componentPublicId) ?? null
    : null;
  if (typeof component?.label === 'string') {
    componentLabels.add(normalizedEvidenceText(component.label));
  }

  return { taskTitles, componentLabels };
}

function copiedExactlyFromStoredContext(params: {
  value: string | null | undefined;
  currentUserText: string;
  storedContextStrings: ReadonlySet<string>;
  machineAuthorizedValues?: ReadonlySet<string>;
}): boolean {
  if (!params.value) return false;
  const normalizedValue = normalizedEvidenceText(params.value);
  if (!normalizedValue || !params.storedContextStrings.has(normalizedValue)) return false;
  if (params.machineAuthorizedValues?.has(normalizedValue)) return false;
  return !normalizedEvidenceText(params.currentUserText).includes(normalizedValue);
}

export function validateWeeklyPlanningCurrentTurnProvenanceV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  currentUserText?: string;
  publicStateSummary?: Record<string, unknown>;
}): string[] {
  if (params.currentUserText === undefined) return [];

  const errors: string[] = [];
  const storedContextStrings = collectStoredContextStrings(params.publicStateSummary);
  const machineBoundValues = contextualMachineBoundEntityValues(params.publicStateSummary);
  const check = (sourceText: string, path: string): void => {
    if (!sourceTextGroundedInCurrentTurn(sourceText, params.currentUserText ?? '')) {
      errors.push(`${path}.sourceText:not-grounded-in-current-user-text`);
    }
  };
  const checkStoredCopy = (
    value: string | null | undefined,
    path: string,
    machineAuthorizedValues?: ReadonlySet<string>,
  ): void => {
    if (copiedExactlyFromStoredContext({
      value,
      currentUserText: params.currentUserText ?? '',
      storedContextStrings,
      machineAuthorizedValues,
    })) {
      errors.push(`${path}:copied-from-stored-context-without-current-mention`);
    }
  };

  if (params.document.planningWindow) {
    check(params.document.planningWindow.sourceText, 'document.planningWindow');
  }

  params.document.tasks.forEach((task, taskIndex) => {
    const taskPath = `document.tasks[${taskIndex}]`;
    if (taskShellNeedsCurrentTurnEvidence(task, params.publicStateSummary)) {
      check(task.sourceText, taskPath);
    }
    if (!task.existingPublicId) {
      checkStoredCopy(task.title, `${taskPath}.title`, machineBoundValues.taskTitles);
    }

    task.workloads.forEach((workload, workloadIndex) => {
      check(workload.sourceText, `${taskPath}.workloads[${workloadIndex}]`);
    });
    task.effortEstimates.forEach((estimate, estimateIndex) => {
      check(estimate.sourceText, `${taskPath}.effortEstimates[${estimateIndex}]`);
    });
    task.temporalConstraints.forEach((constraint, constraintIndex) => {
      check(constraint.sourceText, `${taskPath}.temporalConstraints[${constraintIndex}]`);
    });
    task.recurrence.forEach((recurrence, recurrenceIndex) => {
      check(recurrence.sourceText, `${taskPath}.recurrence[${recurrenceIndex}]`);
    });
    (task.durableContextSignals ?? []).forEach((signal, signalIndex) => {
      const signalPath = `${taskPath}.durableContextSignals[${signalIndex}]`;
      check(signal.sourceText, signalPath);
      checkStoredCopy(signal.value, `${signalPath}.value`);
    });

    (task.study?.components ?? []).forEach((component, componentIndex) => {
      const componentPath = `${taskPath}.study.components[${componentIndex}]`;
      if (componentShellNeedsCurrentTurnEvidence(component, params.publicStateSummary)) {
        check(component.sourceText, componentPath);
      }
      if (!component.existingPublicId) {
        checkStoredCopy(
          component.label,
          `${componentPath}.label`,
          machineBoundValues.componentLabels,
        );
      }
      component.workloads.forEach((workload, workloadIndex) => {
        check(workload.sourceText, `${componentPath}.workloads[${workloadIndex}]`);
      });
      (component.durableContextSignals ?? []).forEach((signal, signalIndex) => {
        const signalPath = `${componentPath}.durableContextSignals[${signalIndex}]`;
        check(signal.sourceText, signalPath);
        checkStoredCopy(signal.value, `${signalPath}.value`);
      });
    });
  });

  params.document.relations.forEach((relation, index) => {
    check(relation.sourceText, `document.relations[${index}]`);
  });
  params.document.availabilityDeclarations.forEach((availability, index) => {
    check(availability.sourceText, `document.availabilityDeclarations[${index}]`);
  });
  params.document.constraintSourceRequests.forEach((request, index) => {
    check(request.sourceText, `document.constraintSourceRequests[${index}]`);
  });
  (params.document.userContextFacts ?? []).forEach((fact, index) => {
    const factPath = `document.userContextFacts[${index}]`;
    check(fact.sourceText, factPath);
    checkStoredCopy(fact.label, `${factPath}.label`);
    checkStoredCopy(fact.value, `${factPath}.value`);
  });
  params.document.uncertainties.forEach((uncertainty, index) => {
    const uncertaintyPath = `document.uncertainties[${index}]`;
    check(uncertainty.sourceText, uncertaintyPath);
    checkStoredCopy(uncertainty.reason, `${uncertaintyPath}.reason`);
  });
  params.document.corrections.forEach((correction, index) => {
    check(correction.sourceText, `document.corrections[${index}]`);
  });
  params.document.decisions.forEach((decision, index) => {
    check(decision.sourceText, `document.decisions[${index}]`);
  });

  return errors;
}
