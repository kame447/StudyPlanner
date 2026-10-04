import { findCyclicComponentAncestryV5 } from './weeklyPlanningComponentHierarchyV5';
import { validateWeeklyPlanningCorrectionReplacementV5, validateWeeklyPlanningUncertaintyValuesV5, validateWeeklyPlanningCorrectionValuesV5, validateWeeklyPlanningDecisionValuesV5, validateWeeklyPlanningCanonicalReferenceKindV5 } from './weeklyPlanningIntentValueValidatorV5';
import { validateWeeklyPlanningRelationValuesV5, validateWeeklyPlanningSourceRequestValuesV5 } from './weeklyPlanningControlValueValidatorV5';
import { validateWeeklyPlanningTaskValuesV5, validateWeeklyPlanningComponentValuesV5, validateWeeklyPlanningStudyContextValuesV5, validateWeeklyPlanningPlanningWindowValuesV5 } from './weeklyPlanningFactPayloadValueValidatorV5';
import { validateWeeklyPlanningAvailabilityBaseValuesV5, validateWeeklyPlanningAvailabilityCapacityValuesV5, validateWeeklyPlanningAvailabilityAbsenceValuesV5 } from './weeklyPlanningAvailabilityValueValidatorV5';
import { validateWeeklyPlanningTemporalValuesV5, validateWeeklyPlanningDateRuleValuesV5 } from './weeklyPlanningTemporalValueValidatorV5';
import { validateWeeklyPlanningRecurrenceValuesV5 } from './weeklyPlanningRecurrenceValueValidatorV5';
import { validateWeeklyPlanningEffortValuesV5, validateWeeklyPlanningWorkloadValuesV5 } from './weeklyPlanningQuantitativeValueValidatorV5';
import {
  isUserUtteranceSourcedV5,
  WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

export interface WeeklyPlanningFactGraphValidationResultV5 {
  graph: WeeklyPlanningFactGraphV5 | null;
  errors: string[];
}

type UnknownFact = Record<string, unknown>;

const USER_AUTHORITY_FACT_PATHS = new Set([
  'graph.planningWindows',
  'graph.uncertainties',
  'graph.correctionIntents',
  'graph.decisionIntents',
  'graph.availabilityDeclarations',
  'graph.constraintSourceRequests',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function validateExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: string,
  errors: string[],
): void {
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) errors.push(`${path}.unknown-key:${key}`);
  }
  for (const key of expectedKeys) {
    if (!(key in value)) errors.push(`${path}.missing-key:${key}`);
  }
}

function validateStringArray(
  value: unknown,
  path: string,
  errors: string[],
): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path}:not-array`);
    return [];
  }
  const values: string[] = [];
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) errors.push(`${path}[${index}]`);
    else values.push(item);
  });
  return values;
}

function validateFactArray(
  value: unknown,
  path: string,
  graphRevision: number,
  allFactIds: Set<string>,
  errors: string[],
): UnknownFact[] {
  if (!Array.isArray(value)) {
    errors.push(`${path}:not-array`);
    return [];
  }
  const facts: UnknownFact[] = [];
  value.forEach((fact, index) => {
    const factPath = `${path}[${index}]`;
    if (!isRecord(fact)) {
      errors.push(`${factPath}:not-object`);
      return;
    }
    if (!isNonEmptyString(fact.id)) {
      errors.push(`${factPath}.id`);
    } else if (allFactIds.has(fact.id)) {
      errors.push(`${factPath}.id:duplicate:${fact.id}`);
    } else {
      allFactIds.add(fact.id);
    }
    if (!isNonNegativeInteger(fact.createdRevision)
      || fact.createdRevision === 0
      || fact.createdRevision > graphRevision) {
      errors.push(`${factPath}.createdRevision`);
    }
    if (!isRecord(fact.source)) {
      errors.push(`${factPath}.source:not-object`);
    } else {
      validateExactKeys(
        fact.source,
        [
          'conversationId',
          'turnId',
          'semanticLocalId',
          'sourceText',
          'origin',
          ...('provenanceChannel' in fact.source ? ['provenanceChannel'] : []),
        ],
        `${factPath}.source`,
        errors,
      );
      if (!isNonEmptyString(fact.source.conversationId)) {
        errors.push(`${factPath}.source.conversationId`);
      }
      if (!isNonEmptyString(fact.source.turnId)) errors.push(`${factPath}.source.turnId`);
      if (!isNonEmptyString(fact.source.semanticLocalId)) {
        errors.push(`${factPath}.source.semanticLocalId`);
      }
      if (!isNonEmptyString(fact.source.sourceText)) {
        errors.push(`${factPath}.source.sourceText`);
      }
      if (fact.source.origin !== 'user') errors.push(`${factPath}.source.origin`);
      if ('provenanceChannel' in fact.source
        && fact.source.provenanceChannel !== 'supplemental') {
        errors.push(`${factPath}.source.provenanceChannel`);
      }
      if (USER_AUTHORITY_FACT_PATHS.has(path)
        && !isUserUtteranceSourcedV5({
          channel: fact.source.provenanceChannel === 'supplemental' ? 'supplemental' : 'user',
        })) {
        errors.push(`${factPath}.source:requires-user-utterance`);
      }
    }
    facts.push(fact);
  });
  return facts;
}

function idsOf(facts: UnknownFact[]): Set<string> {
  return new Set(
    facts
      .map((fact) => fact.id)
      .filter((id): id is string => typeof id === 'string'),
  );
}

function validateReference(
  value: unknown,
  allowedIds: Set<string>,
  path: string,
  errors: string[],
): void {
  if (!isNonEmptyString(value) || !allowedIds.has(value)) errors.push(path);
}

function validateOptionalReference(
  value: unknown,
  allowedIds: Set<string>,
  path: string,
  errors: string[],
): void {
  if (value !== null) validateReference(value, allowedIds, path, errors);
}

function validateLifecycleEntries(params: {
  value: unknown;
  allFactIds: Set<string>;
  revision: number;
  errors: string[];
}): void {
  if (!Array.isArray(params.value)) {
    params.errors.push('graph.factLifecycles:not-array');
    return;
  }
  const lifecycleFactIds = new Set<string>();
  params.value.forEach((entry, index) => {
    const path = `graph.factLifecycles[${index}]`;
    if (!isRecord(entry)) {
      params.errors.push(`${path}:not-object`);
      return;
    }
    validateExactKeys(entry, [
      'factId',
      'status',
      'createdRevision',
      'terminalRevision',
      'supersededByFactId',
    ], path, params.errors);
    if (!isNonEmptyString(entry.factId) || !params.allFactIds.has(entry.factId)) {
      params.errors.push(`${path}.factId`);
    } else if (lifecycleFactIds.has(entry.factId)) {
      params.errors.push(`${path}.factId:duplicate:${entry.factId}`);
    } else {
      lifecycleFactIds.add(entry.factId);
    }
    if (!isNonNegativeInteger(entry.createdRevision)
      || entry.createdRevision === 0
      || entry.createdRevision > params.revision) {
      params.errors.push(`${path}.createdRevision`);
    }
    if (!['active', 'superseded', 'removed'].includes(String(entry.status))) {
      params.errors.push(`${path}.status`);
      return;
    }
    if (entry.status === 'active') {
      if (entry.terminalRevision !== null) params.errors.push(`${path}.terminalRevision`);
      if (entry.supersededByFactId !== null) {
        params.errors.push(`${path}.supersededByFactId`);
      }
      return;
    }
    if (!isNonNegativeInteger(entry.terminalRevision)
      || entry.terminalRevision === 0
      || entry.terminalRevision > params.revision
      || (isNonNegativeInteger(entry.createdRevision)
        && entry.terminalRevision <= entry.createdRevision)) {
      params.errors.push(`${path}.terminalRevision`);
    }
    if (entry.status === 'removed') {
      if (entry.supersededByFactId !== null) {
        params.errors.push(`${path}.supersededByFactId`);
      }
      return;
    }
    if (!isNonEmptyString(entry.supersededByFactId)
      || !params.allFactIds.has(entry.supersededByFactId)
      || entry.supersededByFactId === entry.factId) {
      params.errors.push(`${path}.supersededByFactId`);
    }
  });
  for (const factId of params.allFactIds) {
    if (!lifecycleFactIds.has(factId)) {
      params.errors.push(`graph.factLifecycles:missing:${factId}`);
    }
  }
}

export function validateWeeklyPlanningFactGraphValueV5(
  value: unknown,
): WeeklyPlanningFactGraphValidationResultV5 {
  if (!isRecord(value)) return { graph: null, errors: ['graph:not-object'] };
  const errors: string[] = [];
  validateExactKeys(value, [
    'version',
    'revision',
    'appliedTurnKeys',
    'appliedLifecycleOperationKeys',
    'factLifecycles',
    'planningWindows',
    'tasks',
    'studyContexts',
    'components',
    'workloads',
    'effortEstimates',
    'temporalConstraints',
    'taskDateRules',
    'recurrences',
    'relations',
    'uncertainties',
    'correctionIntents',
    'decisionIntents',
    'availabilityDeclarations',
    'constraintSourceRequests',
  ], 'graph', errors);
  if (value.version !== WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5) errors.push('graph.version');
  if (!isNonNegativeInteger(value.revision)) errors.push('graph.revision');
  const revision = isNonNegativeInteger(value.revision) ? value.revision : 0;

  const turnKeys = validateStringArray(value.appliedTurnKeys, 'graph.appliedTurnKeys', errors);
  if (new Set(turnKeys).size !== turnKeys.length) errors.push('graph.appliedTurnKeys:duplicate');
  const lifecycleKeys = validateStringArray(
    value.appliedLifecycleOperationKeys,
    'graph.appliedLifecycleOperationKeys',
    errors,
  );
  if (new Set(lifecycleKeys).size !== lifecycleKeys.length) {
    errors.push('graph.appliedLifecycleOperationKeys:duplicate');
  }

  const allFactIds = new Set<string>();
  const planningWindows = validateFactArray(
    value.planningWindows,
    'graph.planningWindows',
    revision,
    allFactIds,
    errors,
  );
  const tasks = validateFactArray(value.tasks, 'graph.tasks', revision, allFactIds, errors);
  const studyContexts = validateFactArray(
    value.studyContexts,
    'graph.studyContexts',
    revision,
    allFactIds,
    errors,
  );
  const components = validateFactArray(
    value.components,
    'graph.components',
    revision,
    allFactIds,
    errors,
  );
  const workloads = validateFactArray(
    value.workloads,
    'graph.workloads',
    revision,
    allFactIds,
    errors,
  );
  const effortEstimates = validateFactArray(
    value.effortEstimates,
    'graph.effortEstimates',
    revision,
    allFactIds,
    errors,
  );
  const temporalConstraints = validateFactArray(
    value.temporalConstraints,
    'graph.temporalConstraints',
    revision,
    allFactIds,
    errors,
  );
  const taskDateRules = validateFactArray(
    value.taskDateRules,
    'graph.taskDateRules',
    revision,
    allFactIds,
    errors,
  );
  const recurrences = validateFactArray(
    value.recurrences,
    'graph.recurrences',
    revision,
    allFactIds,
    errors,
  );
  const relations = validateFactArray(
    value.relations,
    'graph.relations',
    revision,
    allFactIds,
    errors,
  );
  const uncertainties = validateFactArray(
    value.uncertainties,
    'graph.uncertainties',
    revision,
    allFactIds,
    errors,
  );
  const correctionIntents = validateFactArray(
    value.correctionIntents,
    'graph.correctionIntents',
    revision,
    allFactIds,
    errors,
  );
  const decisionIntents = validateFactArray(
    value.decisionIntents,
    'graph.decisionIntents',
    revision,
    allFactIds,
    errors,
  );
  const availabilityDeclarations = validateFactArray(
    value.availabilityDeclarations,
    'graph.availabilityDeclarations',
    revision,
    allFactIds,
    errors,
  );
  const constraintSourceRequests = validateFactArray(
    value.constraintSourceRequests,
    'graph.constraintSourceRequests',
    revision,
    allFactIds,
    errors,
  );
  if (revision === 0 && allFactIds.size > 0) errors.push('graph.revision:zero-with-facts');

  validateLifecycleEntries({
    value: value.factLifecycles,
    allFactIds,
    revision,
    errors,
  });

  const taskIds = idsOf(tasks);
  const componentIds = idsOf(components);
  const workloadIds = idsOf(workloads);
  const effortIds = idsOf(effortEstimates);
  const temporalIds = idsOf(temporalConstraints);
  const taskDateRuleIds = idsOf(taskDateRules);
  const recurrenceIds = idsOf(recurrences);
  const relationIds = idsOf(relations);
  const planningWindowIds = idsOf(planningWindows);
  const availabilityDeclarationIds = idsOf(availabilityDeclarations);
  const targetIds = new Set([
    ...taskIds,
    ...componentIds,
    ...workloadIds,
    ...effortIds,
    ...temporalIds,
    ...taskDateRuleIds,
    ...recurrenceIds,
    ...relationIds,
    ...planningWindowIds,
    ...availabilityDeclarationIds,
  ]);
  const taskOrComponentIds = new Set([...taskIds, ...componentIds]);
  const effortTargetIds = new Set([...taskIds, ...componentIds, ...workloadIds]);

  tasks.forEach((fact, index) => validateWeeklyPlanningTaskValuesV5(fact, `graph.tasks[${index}]`, errors));
  planningWindows.forEach((fact, index) => validateWeeklyPlanningPlanningWindowValuesV5(fact, `graph.planningWindows[${index}]`, errors));
  availabilityDeclarations.forEach((fact, index) => {
    const path = `graph.availabilityDeclarations[${index}]`;
    if (fact.kind === 'no_additional_constraint') {
      validateWeeklyPlanningAvailabilityAbsenceValuesV5(fact, path, errors);
    } else {
      validateWeeklyPlanningAvailabilityBaseValuesV5(fact, path, errors);
    }
    validateWeeklyPlanningAvailabilityCapacityValuesV5(fact, path, errors);
    if (fact.resolutionStatus !== 'unresolved') errors.push(`${path}.resolutionStatus`);
  });
  studyContexts.forEach((fact, index) => {
    validateWeeklyPlanningStudyContextValuesV5(fact, `graph.studyContexts[${index}]`, errors);
    validateReference(fact.taskId, taskIds, `graph.studyContexts[${index}].taskId`, errors);
  });
  const componentById = new Map(components.filter(fact => isNonEmptyString(fact.id)).map(fact => [fact.id as string, fact]));
  const parentById = new Map<string, string | null>();
  for (const [id, fact] of componentById) {
    if (fact.parentComponentId === null || typeof fact.parentComponentId === 'string') {
      parentById.set(id, fact.parentComponentId);
    }
  }
  const cyclicAncestry = findCyclicComponentAncestryV5(parentById);
  components.forEach((fact, index) => {
    validateWeeklyPlanningComponentValuesV5(fact, `graph.components[${index}]`, errors);
    validateReference(fact.taskId, taskIds, `graph.components[${index}].taskId`, errors);
    validateOptionalReference(
      fact.parentComponentId,
      componentIds,
      `graph.components[${index}].parentComponentId`,
      errors,
    );
    const parent = typeof fact.parentComponentId === 'string' ? componentById.get(fact.parentComponentId) : undefined;
    if (parent && parent.taskId !== fact.taskId) {
      errors.push(`graph.components[${index}].parentComponentId:task-mismatch`);
    }
    if (typeof fact.id === 'string' && cyclicAncestry.has(fact.id)) {
      errors.push(`graph.components[${index}].parentComponentId:cycle`);
    }
  });
  workloads.forEach((fact, index) => {
    validateWeeklyPlanningWorkloadValuesV5(fact, `graph.workloads[${index}]`, errors);
    validateReference(fact.taskId, taskIds, `graph.workloads[${index}].taskId`, errors);
    validateOptionalReference(
      fact.componentId,
      componentIds,
      `graph.workloads[${index}].componentId`,
      errors,
    );
  });
  effortEstimates.forEach((fact, index) => {
    validateWeeklyPlanningEffortValuesV5(fact, `graph.effortEstimates[${index}]`, errors);
    validateReference(fact.taskId, taskIds, `graph.effortEstimates[${index}].taskId`, errors);
    validateReference(
      fact.targetFactId,
      effortTargetIds,
      `graph.effortEstimates[${index}].targetFactId`,
      errors,
    );
  });
  temporalConstraints.forEach((fact, index) => {
    validateWeeklyPlanningTemporalValuesV5(fact, `graph.temporalConstraints[${index}]`, errors);
    validateReference(
      fact.taskId,
      taskIds,
      `graph.temporalConstraints[${index}].taskId`,
      errors,
    );
    validateReference(
      fact.targetFactId,
      taskOrComponentIds,
      `graph.temporalConstraints[${index}].targetFactId`,
      errors,
    );
  });
  taskDateRules.forEach((fact, index) => {
    validateWeeklyPlanningDateRuleValuesV5(fact, `graph.taskDateRules[${index}]`, errors);
    validateReference(fact.taskId, taskIds, `graph.taskDateRules[${index}].taskId`, errors);
    validateReference(
      fact.targetFactId,
      taskIds,
      `graph.taskDateRules[${index}].targetFactId`,
      errors,
    );
    if (fact.taskId !== fact.targetFactId) {
      errors.push(`graph.taskDateRules[${index}].targetFactId:must-equal-taskId`);
    }
  });
  recurrences.forEach((fact, index) => {
    validateWeeklyPlanningRecurrenceValuesV5(fact, `graph.recurrences[${index}]`, errors);
    validateReference(fact.taskId, taskIds, `graph.recurrences[${index}].taskId`, errors);
    validateReference(
      fact.targetFactId,
      taskOrComponentIds,
      `graph.recurrences[${index}].targetFactId`,
      errors,
    );
  });
  relations.forEach((fact, index) => {
    validateWeeklyPlanningRelationValuesV5(fact, `graph.relations[${index}]`, errors);
    validateReference(fact.fromTaskId, taskIds, `graph.relations[${index}].fromTaskId`, errors);
    validateReference(fact.toTaskId, taskIds, `graph.relations[${index}].toTaskId`, errors);
    if (fact.fromTaskId === fact.toTaskId) errors.push(`graph.relations[${index}]:self-relation`);
  });
  constraintSourceRequests.forEach((fact, index) => {
    const path = `graph.constraintSourceRequests[${index}]`;
    validateWeeklyPlanningSourceRequestValuesV5(fact, path, errors);
    if (fact.resolutionStatus !== 'unresolved') errors.push(`${path}.resolutionStatus`);
  });
  uncertainties.forEach((fact, index) => {
    validateWeeklyPlanningUncertaintyValuesV5(fact, `graph.uncertainties[${index}]`, errors);
    if (fact.targetFactId !== null) {
      validateReference(
        fact.targetFactId,
        targetIds,
        `graph.uncertainties[${index}].targetFactId`,
        errors,
      );
    }
  });

  const validateIntentReference = (fact: UnknownFact, path: string): void => {
    if (!isRecord(fact.target)) {
      errors.push(`${path}.target:not-object`);
      return;
    }
    validateExactKeys(
      fact.target,
      ['kind', 'publicId', 'factId', 'mention'],
      `${path}.target`,
      errors,
    );
    validateWeeklyPlanningCanonicalReferenceKindV5(fact.target.kind, `${path}.target.kind`, errors);
    if (fact.target.factId !== null) {
      validateReference(fact.target.factId, targetIds, `${path}.target.factId`, errors);
    }
    if (fact.target.publicId !== null && !isNonEmptyString(fact.target.publicId)) {
      errors.push(`${path}.target.publicId`);
    }
    if (fact.target.mention !== null && !isNonEmptyString(fact.target.mention)) {
      errors.push(`${path}.target.mention`);
    }
    if (fact.target.factId === null
      && fact.target.publicId === null
      && fact.target.mention === null) {
      errors.push(`${path}.target:empty-reference`);
    }
  };
  correctionIntents.forEach((fact, index) => {
    validateWeeklyPlanningCorrectionValuesV5(fact, `graph.correctionIntents[${index}]`, errors);
    validateIntentReference(fact, `graph.correctionIntents[${index}]`);
    if (validateWeeklyPlanningCorrectionReplacementV5(
      fact.operation, fact.replacementFactId, `graph.correctionIntents[${index}].replacementFactId`, errors,
    )) {
      validateReference(
        fact.replacementFactId,
        targetIds,
        `graph.correctionIntents[${index}].replacementFactId`,
        errors,
      );
    }
  });
  decisionIntents.forEach((fact, index) => {
    validateWeeklyPlanningDecisionValuesV5(fact, `graph.decisionIntents[${index}]`, errors);
    validateIntentReference(fact, `graph.decisionIntents[${index}]`);
  });

  return {
    graph: errors.length === 0 ? value as unknown as WeeklyPlanningFactGraphV5 : null,
    errors,
  };
}

export function parseWeeklyPlanningFactGraphV5(
  content: string,
): WeeklyPlanningFactGraphValidationResultV5 {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { graph: null, errors: ['graph:invalid-json'] };
  }
  return validateWeeklyPlanningFactGraphValueV5(value);
}

export function serializeWeeklyPlanningFactGraphV5(
  graph: WeeklyPlanningFactGraphV5,
): string {
  const validation = validateWeeklyPlanningFactGraphValueV5(graph);
  if (!validation.graph) {
    throw new Error(`Invalid WeeklyPlanningFactGraphV5: ${validation.errors.join(',')}`);
  }
  return JSON.stringify(graph);
}
