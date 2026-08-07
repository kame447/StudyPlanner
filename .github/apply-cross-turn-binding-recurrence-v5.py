from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} match(es), found {count}: {old[:160]!r}')
    p.write_text(text.replace(old, new, expected))


semantic = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5.ts'
replace_exact(
    semantic,
    "export interface SemanticStudyComponentV5 extends SemanticSourceEvidenceV5 {\n  localId: string;\n  parentLocalId: string | null;",
    "export interface SemanticStudyComponentV5 extends SemanticSourceEvidenceV5 {\n"
    "  localId: string;\n"
    "  existingPublicId?: string | null;\n"
    "  parentLocalId: string | null;",
)
replace_exact(
    semantic,
    "export interface SemanticTaskV5 extends SemanticSourceEvidenceV5 {\n  localId: string;\n  category:",
    "export interface SemanticTaskV5 extends SemanticSourceEvidenceV5 {\n"
    "  localId: string;\n"
    "  existingPublicId?: string | null;\n"
    "  category:",
)
replace_exact(
    semantic,
    "    'localId',\n    'parentLocalId',\n    'role',",
    "    'localId',\n    'existingPublicId',\n    'parentLocalId',\n    'role',",
)
replace_exact(
    semantic,
    "    localId: { type: 'string' },\n    parentLocalId: nullableStringSchema,",
    "    localId: { type: 'string' },\n"
    "    existingPublicId: nullableStringSchema,\n"
    "    parentLocalId: nullableStringSchema,",
    expected=1,
)
replace_exact(
    semantic,
    "    'localId',\n    'category',\n    'title',",
    "    'localId',\n    'existingPublicId',\n    'category',\n    'title',",
)
replace_exact(
    semantic,
    "  properties: {\n    localId: { type: 'string' },\n    category: { type: 'string', enum: SEMANTIC_TASK_CATEGORIES_V5 },",
    "  properties: {\n"
    "    localId: { type: 'string' },\n"
    "    existingPublicId: nullableStringSchema,\n"
    "    category: { type: 'string', enum: SEMANTIC_TASK_CATEGORIES_V5 },",
)
replace_exact(
    semantic,
    "    'Keep unrelated activities as separate tasks. Preserve before, after, dependency, priority, and sequence relations with response-local task IDs.',\n",
    "    'Keep unrelated activities as separate tasks. Preserve before, after, dependency, priority, and sequence relations with response-local task IDs.',\n"
    "    'Every task/component must set existingPublicId: use the exact publicId from publicStateSummary when current userText continues the same accepted entity, otherwise null. Do not create a duplicate task/component merely to add workload, effort, time, recurrence, or detail. If identity is ambiguous, emit uncertainty instead of guessing.',\n",
)
replace_exact(
    semantic,
    "    'Every task and study component must return durableContextSignals, using an empty array when none apply.",
    "    'Every task and study component must return durableContextSignals, using an empty array when none apply.",
)

validator = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticValidatorV5.ts'
replace_exact(
    validator,
    "function stripDurableContextSignals(value: Record<string, unknown>): Record<string, unknown> {",
    "function stripSemanticExtensions(value: Record<string, unknown>): Record<string, unknown> {",
)
replace_exact(
    validator,
    "        const { durableContextSignals: _taskSignals, ...taskRest } = task;",
    "        const {\n"
    "          durableContextSignals: _taskSignals,\n"
    "          existingPublicId: _taskExistingPublicId,\n"
    "          ...taskRest\n"
    "        } = task;",
)
replace_exact(
    validator,
    "          const { durableContextSignals: _componentSignals, ...componentRest } = component;",
    "          const {\n"
    "            durableContextSignals: _componentSignals,\n"
    "            existingPublicId: _componentExistingPublicId,\n"
    "            ...componentRest\n"
    "          } = component;",
)
insert_before = "function validateDurableContextSignals(\n"
existing_validation = '''function validateExistingPublicIds(value: Record<string, unknown>): string[] {
  if (!Array.isArray(value.tasks)) return [];
  const errors: string[] = [];
  const validateId = (id: unknown, path: string): void => {
    if (id === undefined) return;
    if (!(id === null || (typeof id === 'string' && id.trim().length > 0))) {
      errors.push(`${path}:expected-non-empty-string-or-null`);
    }
  };
  value.tasks.forEach((task, taskIndex) => {
    if (!isRecord(task)) return;
    validateId(task.existingPublicId, `document.tasks[${taskIndex}].existingPublicId`);
    if (!isRecord(task.study) || !Array.isArray(task.study.components)) return;
    task.study.components.forEach((component, componentIndex) => {
      if (!isRecord(component)) return;
      validateId(
        component.existingPublicId,
        `document.tasks[${taskIndex}].study.components[${componentIndex}].existingPublicId`,
      );
    });
  });
  return errors;
}

'''
replace_exact(validator, insert_before, existing_validation + insert_before)
replace_exact(
    validator,
    "  const legacyWeeklyValue = stripDurableContextSignals(weeklyValue);",
    "  const legacyWeeklyValue = stripSemanticExtensions(weeklyValue);",
)
replace_exact(
    validator,
    "  const signalErrors = validateDurableContextSignals(weeklyValue, baseLocalIds);\n  const contextErrors = validateUserContextFacts(",
    "  const existingPublicIdErrors = validateExistingPublicIds(weeklyValue);\n"
    "  const signalErrors = validateDurableContextSignals(weeklyValue, baseLocalIds);\n"
    "  const contextErrors = validateUserContextFacts(",
)
replace_exact(
    validator,
    "  const structuralErrors = [...legacyErrors, ...signalErrors, ...contextErrors];",
    "  const structuralErrors = [\n"
    "    ...legacyErrors,\n"
    "    ...existingPublicIdErrors,\n"
    "    ...signalErrors,\n"
    "    ...contextErrors,\n"
    "  ];",
)

normalizer = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts'
replace_exact(
    normalizer,
    "import {\n  normalizeExactDuplicateWorkloadPlacementV5,\n} from './weeklyPlanningDuplicateWorkloadNormalizationV5';\n",
    "import {\n"
    "  normalizeExactDuplicateWorkloadPlacementV5,\n"
    "} from './weeklyPlanningDuplicateWorkloadNormalizationV5';\n"
    "import {\n"
    "  validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5,\n"
    "} from './weeklyPlanningExistingEntityBindingV5';\n"
    "import {\n"
    "  validateWeeklyPlanningRecurrenceConsistencyV5,\n"
    "} from './weeklyPlanningRecurrenceConsistencyV5';\n",
)
replace_exact(
    normalizer,
    "    ...planningWindowCanonicalValueErrors(parsed.document.planningWindow),\n    ...validateWeeklyPlanningSemanticEvidenceV5({",
    "    ...planningWindowCanonicalValueErrors(parsed.document.planningWindow),\n"
    "    ...validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5({\n"
    "      document: parsed.document,\n"
    "      publicStateSummary: input.publicStateSummary,\n"
    "    }),\n"
    "    ...validateWeeklyPlanningRecurrenceConsistencyV5(parsed.document),\n"
    "    ...validateWeeklyPlanningSemanticEvidenceV5({",
)
replace_exact(
    normalizer,
    "  if (errors.some((error) => error.includes('not-grounded-in-current-user-text'))) {",
    "  if (errors.some((error) => error.includes('existing-task-binding-required') || error.includes('existing-component-binding-required') || error.includes('unknown-active-task') || error.includes('unknown-active-component') || error.includes('component-task-binding-mismatch'))) {\n"
    "    directives.push('For each continued accepted task/component, set existingPublicId to the exact candidate publicId from publicStateSummary. Keep existingPublicId null only for genuinely new entities. Never duplicate an accepted entity just to add current-turn facts.');\n"
    "  }\n"
    "  if (errors.some((error) => error.includes('explicit-recurrence-missing'))) {\n"
    "    directives.push('When a per-occurrence workload explicitly represents daily, weekdays, or weekends repetition, add the matching recurrence targeting the same task/component localId. periodExpression does not replace recurrence.');\n"
    "  }\n"
    "  if (errors.some((error) => error.includes('not-grounded-in-current-user-text'))) {",
)
replace_exact(
    normalizer,
    "  'For semantic_uncertainty, return only its resolving semantic delta; if still unresolved, emit uncertainty.',\n",
    "  'For semantic_uncertainty, return only its resolving semantic delta; if still unresolved, emit uncertainty.',\n"
    "  'existingPublicId is an exact reference to an accepted publicStateSummary task/component, never a localId. Use it for cross-turn continuation and null for new entities.',\n",
)
replace_exact(
    normalizer,
    "  'Explicit repeating weekdays use one weekly recurrence with all stated days.',\n",
    "  'Explicit repeating weekdays use one weekly recurrence with all stated days.',\n"
    "  'Explicit daily/weekdays/weekends repetition must be represented by recurrence; do not encode repetition only in workload.periodExpression.',\n",
)

pipeline = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPipelineV5.ts'
replace_exact(
    pipeline,
    "import {\n  compileGenericSchedulerInput,",
    "import {\n"
    "  applyWeeklyPlanningExistingEntityBindingsV5,\n"
    "} from './weeklyPlanningExistingEntityBindingApplicationV5';\n"
    "import {\n  compileGenericSchedulerInput,",
)
old = '''      const baseCanonicalization = contextualAnswer
        ?? canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
          graph,
          document: normalization.document,
          context: canonicalizationContext,
        });
      const correctionResult = applyCanonicalCorrectionResult({
        originalGraph: graph,
        canonicalization: baseCanonicalization,
        operationKeyPrefix: `${input.conversationId}:${input.turnId}`,
      });
'''
new = '''      const baseCanonicalization = contextualAnswer
        ?? canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
          graph,
          document: normalization.document,
          context: canonicalizationContext,
        });
      const entityBindingApplication = contextualAnswer
        ? {
            version: 'weekly-planning-existing-entity-binding-application-v5' as const,
            status: 'not_applicable' as const,
            canonicalization: baseCanonicalization,
            errors: [],
          }
        : applyWeeklyPlanningExistingEntityBindingsV5({
            originalGraph: graph,
            document: normalization.document,
            canonicalization: baseCanonicalization,
          });
      const boundCanonicalization = entityBindingApplication.canonicalization;
      recordWeeklyPlanningStableV5DebugTrace({
        requestId: input.turnId,
        stage: 'existing_entity_binding_application_evaluated',
        severity: entityBindingApplication.status === 'rejected' ? 'error' : 'info',
        data: entityBindingApplication,
      });
      const correctionResult = applyCanonicalCorrectionResult({
        originalGraph: graph,
        canonicalization: boundCanonicalization,
        operationKeyPrefix: `${input.conversationId}:${input.turnId}`,
      });
'''
replace_exact(pipeline, old, new)
replace_exact(
    pipeline,
    "          inputCanonicalization: baseCanonicalization,",
    "          inputCanonicalization: boundCanonicalization,",
)
