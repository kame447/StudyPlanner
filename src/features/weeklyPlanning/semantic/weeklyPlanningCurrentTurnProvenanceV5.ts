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

export function validateWeeklyPlanningCurrentTurnProvenanceV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  currentUserText?: string;
  publicStateSummary?: Record<string, unknown>;
}): string[] {
  if (params.currentUserText === undefined) return [];

  const errors: string[] = [];
  const check = (sourceText: string, path: string): void => {
    if (!sourceTextGroundedInCurrentTurn(sourceText, params.currentUserText ?? '')) {
      errors.push(`${path}.sourceText:not-grounded-in-current-user-text`);
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
      check(signal.sourceText, `${taskPath}.durableContextSignals[${signalIndex}]`);
    });

    (task.study?.components ?? []).forEach((component, componentIndex) => {
      const componentPath = `${taskPath}.study.components[${componentIndex}]`;
      if (componentShellNeedsCurrentTurnEvidence(component, params.publicStateSummary)) {
        check(component.sourceText, componentPath);
      }
      component.workloads.forEach((workload, workloadIndex) => {
        check(workload.sourceText, `${componentPath}.workloads[${workloadIndex}]`);
      });
      (component.durableContextSignals ?? []).forEach((signal, signalIndex) => {
        check(signal.sourceText, `${componentPath}.durableContextSignals[${signalIndex}]`);
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
    check(fact.sourceText, `document.userContextFacts[${index}]`);
  });
  params.document.uncertainties.forEach((uncertainty, index) => {
    check(uncertainty.sourceText, `document.uncertainties[${index}]`);
  });
  params.document.corrections.forEach((correction, index) => {
    check(correction.sourceText, `document.corrections[${index}]`);
  });
  params.document.decisions.forEach((decision, index) => {
    check(decision.sourceText, `document.decisions[${index}]`);
  });

  return [...new Set(errors)];
}
