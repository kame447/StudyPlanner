import {
  WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

export interface WeeklyPlanningFactGraphValidationResultV5 {
  graph: WeeklyPlanningFactGraphV5 | null;
  errors: string[];
}

type UnknownFact = Record<string, unknown>;

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
        ['conversationId', 'turnId', 'semanticLocalId', 'sourceText', 'origin'],
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
  validateFactArray(
    value.availabilityDeclarations,
    'graph.availabilityDeclarations',
    revision,
    allFactIds,
    errors,
  );
  validateFactArray(
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
  ]);
  const taskOrComponentIds = new Set([...taskIds, ...componentIds]);
  const effortTargetIds = new Set([...taskIds, ...componentIds, ...workloadIds]);

  studyContexts.forEach((fact, index) => {
    validateReference(fact.taskId, taskIds, `graph.studyContexts[${index}].taskId`, errors);
  });
  components.forEach((fact, index) => {
    validateReference(fact.taskId, taskIds, `graph.components[${index}].taskId`, errors);
    validateOptionalReference(
      fact.parentComponentId,
      componentIds,
      `graph.components[${index}].parentComponentId`,
      errors,
    );
  });
  workloads.forEach((fact, index) => {
    validateReference(fact.taskId, taskIds, `graph.workloads[${index}].taskId`, errors);
    validateOptionalReference(
      fact.componentId,
      componentIds,
      `graph.workloads[${index}].componentId`,
      errors,
    );
  });
  effortEstimates.forEach((fact, index) => {
    validateReference(fact.taskId, taskIds, `graph.effortEstimates[${index}].taskId`, errors);
    validateReference(
      fact.targetFactId,
      effortTargetIds,
      `graph.effortEstimates[${index}].targetFactId`,
      errors,
    );
  });
  temporalConstraints.forEach((fact, index) => {
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
    validateReference(fact.taskId, taskIds, `graph.recurrences[${index}].taskId`, errors);
    validateReference(
      fact.targetFactId,
      taskOrComponentIds,
      `graph.recurrences[${index}].targetFactId`,
      errors,
    );
  });
  relations.forEach((fact, index) => {
    validateReference(fact.fromTaskId, taskIds, `graph.relations[${index}].fromTaskId`, errors);
    validateReference(fact.toTaskId, taskIds, `graph.relations[${index}].toTaskId`, errors);
    if (fact.fromTaskId === fact.toTaskId) errors.push(`graph.relations[${index}]:self-relation`);
  });
  uncertainties.forEach((fact, index) => {
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
    validateIntentReference(fact, `graph.correctionIntents[${index}]`);
    if (fact.replacementFactId !== null) {
      validateReference(
        fact.replacementFactId,
        targetIds,
        `graph.correctionIntents[${index}].replacementFactId`,
        errors,
      );
    }
  });
  decisionIntents.forEach((fact, index) => {
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
