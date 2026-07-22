import {
  WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

export interface WeeklyPlanningFactGraphValidationResultV5 {
  graph: WeeklyPlanningFactGraphV5 | null;
  errors: string[];
}

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
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    errors.push(`${path}:not-array`);
    return [];
  }
  const facts: Array<Record<string, unknown>> = [];
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
      const source = fact.source;
      validateExactKeys(
        source,
        ['conversationId', 'turnId', 'semanticLocalId', 'sourceText', 'origin'],
        `${factPath}.source`,
        errors,
      );
      if (!isNonEmptyString(source.conversationId)) {
        errors.push(`${factPath}.source.conversationId`);
      }
      if (!isNonEmptyString(source.turnId)) errors.push(`${factPath}.source.turnId`);
      if (!isNonEmptyString(source.semanticLocalId)) {
        errors.push(`${factPath}.source.semanticLocalId`);
      }
      if (!isNonEmptyString(source.sourceText)) errors.push(`${factPath}.source.sourceText`);
      if (source.origin !== 'user') errors.push(`${factPath}.source.origin`);
    }
    facts.push(fact);
  });
  return facts;
}

function factIdSet(facts: Array<Record<string, unknown>>): Set<string> {
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

export function validateWeeklyPlanningFactGraphValueV5(
  value: unknown,
): WeeklyPlanningFactGraphValidationResultV5 {
  if (!isRecord(value)) return { graph: null, errors: ['graph:not-object'] };
  const errors: string[] = [];
  validateExactKeys(value, [
    'version',
    'revision',
    'appliedTurnKeys',
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
  if (value.version !== WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5) {
    errors.push('graph.version');
  }
  if (!isNonNegativeInteger(value.revision)) errors.push('graph.revision');
  const revision = isNonNegativeInteger(value.revision) ? value.revision : 0;
  const turnKeys = validateStringArray(value.appliedTurnKeys, 'graph.appliedTurnKeys', errors);
  if (new Set(turnKeys).size !== turnKeys.length) errors.push('graph.appliedTurnKeys:duplicate');

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
  const taskIds = factIdSet(tasks);
  const componentIds = factIdSet(components);
  const workloadIds = factIdSet(workloads);
  const effortIds = factIdSet(effortEstimates);
  const temporalIds = factIdSet(temporalConstraints);
  const taskDateRuleIds = factIdSet(taskDateRules);
  const recurrenceIds = factIdSet(recurrences);
  const relationIds = factIdSet(relations);
  const planningWindowIds = factIdSet(planningWindows);
  const proposalIds = new Set<string>();
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
    ...proposalIds,
  ]);

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
      new Set([...taskIds, ...componentIds]),
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
      new Set([...taskIds, ...componentIds]),
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
      new Set([...taskIds, ...componentIds]),
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

  const validateIntentReference = (
    fact: Record<string, unknown>,
    path: string,
  ): void => {
    if (!isRecord(fact.target)) {
      errors.push(`${path}.target:not-object`);
      return;
    }
    const target = fact.target;
    validateExactKeys(target, ['kind', 'publicId', 'factId', 'mention'], `${path}.target`, errors);
    if (target.factId !== null) validateReference(target.factId, targetIds, `${path}.target.factId`, errors);
    if (target.publicId !== null && !isNonEmptyString(target.publicId)) {
      errors.push(`${path}.target.publicId`);
    }
    if (target.mention !== null && !isNonEmptyString(target.mention)) {
      errors.push(`${path}.target.mention`);
    }
    if (target.factId === null && target.publicId === null && target.mention === null) {
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
