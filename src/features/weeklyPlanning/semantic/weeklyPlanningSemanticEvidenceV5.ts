import type {
  SemanticStudyComponentV5,
  SemanticTaskV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_SEMANTIC_EVIDENCE_VERSION_V5 =
  'weekly-planning-semantic-evidence-v5' as const;

interface SourceEvidenceEntryV5 {
  path: string;
  sourceText: string;
}

export interface WeeklyPlanningSemanticEvidenceInputV5 {
  userText: string;
  publicStateSummary?: Record<string, unknown>;
}

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasArrayValues(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasAcceptedPublicFacts(
  publicStateSummary: Record<string, unknown> | undefined,
): boolean {
  if (!publicStateSummary) return false;
  return [
    'planningWindows',
    'tasks',
    'components',
    'workloads',
    'effortEstimates',
    'temporalConstraints',
    'recurrences',
    'uncertainties',
  ].some((key) => hasArrayValues(publicStateSummary[key]));
}

function hasPendingQuestion(
  publicStateSummary: Record<string, unknown> | undefined,
): boolean {
  const pendingQuestion = publicStateSummary?.pendingQuestion;
  return Boolean(
    pendingQuestion
    && typeof pendingQuestion === 'object'
    && !Array.isArray(pendingQuestion),
  );
}

function componentEvidence(
  component: SemanticStudyComponentV5,
  path: string,
): SourceEvidenceEntryV5[] {
  return [
    { path: `${path}.sourceText`, sourceText: component.sourceText },
    ...component.workloads.map((workload, index) => ({
      path: `${path}.workloads[${index}].sourceText`,
      sourceText: workload.sourceText,
    })),
  ];
}

function taskEvidence(
  task: SemanticTaskV5,
  path: string,
): SourceEvidenceEntryV5[] {
  return [
    { path: `${path}.sourceText`, sourceText: task.sourceText },
    ...task.workloads.map((workload, index) => ({
      path: `${path}.workloads[${index}].sourceText`,
      sourceText: workload.sourceText,
    })),
    ...task.effortEstimates.map((estimate, index) => ({
      path: `${path}.effortEstimates[${index}].sourceText`,
      sourceText: estimate.sourceText,
    })),
    ...task.temporalConstraints.map((constraint, index) => ({
      path: `${path}.temporalConstraints[${index}].sourceText`,
      sourceText: constraint.sourceText,
    })),
    ...task.recurrence.map((recurrence, index) => ({
      path: `${path}.recurrence[${index}].sourceText`,
      sourceText: recurrence.sourceText,
    })),
    ...(task.study?.components ?? []).flatMap((component, index) =>
      componentEvidence(component, `${path}.study.components[${index}]`)),
  ];
}

function userContextEvidence(
  document: WeeklyPlanningSemanticDocumentV5,
): SourceEvidenceEntryV5[] {
  return document.userContextFacts.map((fact, index) => ({
    path: `document.userContextFacts[${index}].sourceText`,
    sourceText: fact.sourceText,
  }));
}

function collectSourceEvidence(
  document: WeeklyPlanningSemanticDocumentV5,
): SourceEvidenceEntryV5[] {
  return [
    ...(document.planningWindow
      ? [{
          path: 'document.planningWindow.sourceText',
          sourceText: document.planningWindow.sourceText,
        }]
      : []),
    ...document.tasks.flatMap((task, index) =>
      taskEvidence(task, `document.tasks[${index}]`)),
    ...document.relations.map((relation, index) => ({
      path: `document.relations[${index}].sourceText`,
      sourceText: relation.sourceText,
    })),
    ...document.availabilityDeclarations.map((availability, index) => ({
      path: `document.availabilityDeclarations[${index}].sourceText`,
      sourceText: availability.sourceText,
    })),
    ...document.constraintSourceRequests.map((request, index) => ({
      path: `document.constraintSourceRequests[${index}].sourceText`,
      sourceText: request.sourceText,
    })),
    ...document.uncertainties.map((uncertainty, index) => ({
      path: `document.uncertainties[${index}].sourceText`,
      sourceText: uncertainty.sourceText,
    })),
    ...document.corrections.map((correction, index) => ({
      path: `document.corrections[${index}].sourceText`,
      sourceText: correction.sourceText,
    })),
    ...document.decisions.map((decision, index) => ({
      path: `document.decisions[${index}].sourceText`,
      sourceText: decision.sourceText,
    })),
    ...userContextEvidence(document),
  ];
}

function groundingErrors(
  entries: SourceEvidenceEntryV5[],
  userText: string,
): string[] {
  const normalizedUserText = normalized(userText);
  return entries
    .filter(({ sourceText }) => {
      const evidence = normalized(sourceText);
      return evidence.length > 0 && !normalizedUserText.includes(evidence);
    })
    .map(({ path }) => `${path}:not-grounded-in-current-user-text`);
}

export function validateWeeklyPlanningSemanticEvidenceV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  input: WeeklyPlanningSemanticEvidenceInputV5;
}): string[] {
  const userContextErrors = groundingErrors(
    userContextEvidence(params.document),
    params.input.userText,
  );
  const contextualTurn = hasPendingQuestion(params.input.publicStateSummary);
  const authorizationOverAcceptedState =
    params.document.planningIntent === 'create_plan'
    && hasAcceptedPublicFacts(params.input.publicStateSummary);
  if (!contextualTurn && !authorizationOverAcceptedState) return userContextErrors;

  return groundingErrors(
    collectSourceEvidence(params.document),
    params.input.userText,
  );
}
