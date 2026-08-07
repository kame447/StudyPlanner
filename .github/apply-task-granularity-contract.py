from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, got {count}: {old[:120]}')
    p.write_text(text.replace(old, new, 1))

# Semantic document: entity-local granularity contract.
path = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5.ts'
replace_once(
    path,
    "export const SEMANTIC_TASK_CATEGORIES_V5 = ['study', 'non_study', 'unknown'] as const;\nexport type SemanticTaskCategoryV5 = (typeof SEMANTIC_TASK_CATEGORIES_V5)[number];\n",
    "export const SEMANTIC_TASK_CATEGORIES_V5 = ['study', 'non_study', 'unknown'] as const;\nexport type SemanticTaskCategoryV5 = (typeof SEMANTIC_TASK_CATEGORIES_V5)[number];\n\nexport const SEMANTIC_TASK_DECOMPOSITION_STATUSES_V5 = [\n  'atomic',\n  'decomposed',\n  'needs_breakdown',\n] as const;\nexport type SemanticTaskDecompositionStatusV5 =\n  (typeof SEMANTIC_TASK_DECOMPOSITION_STATUSES_V5)[number];\n",
)
replace_once(
    path,
    "export interface SemanticTaskV5 extends SemanticSourceEvidenceV5 {\n  localId: string;\n  existingPublicId?: string | null;\n  category: SemanticTaskCategoryV5;\n",
    "export interface SemanticTaskV5 extends SemanticSourceEvidenceV5 {\n  localId: string;\n  existingPublicId?: string | null;\n  decompositionStatus?: SemanticTaskDecompositionStatusV5;\n  category: SemanticTaskCategoryV5;\n",
)
replace_once(
    path,
    "    'existingPublicId',\n    'category',\n    'title',\n",
    "    'existingPublicId',\n    'decompositionStatus',\n    'category',\n    'title',\n",
)
replace_once(
    path,
    "    existingPublicId: nullableStringSchema,\n    category: { type: 'string', enum: SEMANTIC_TASK_CATEGORIES_V5 },\n",
    "    existingPublicId: nullableStringSchema,\n    decompositionStatus: {\n      type: 'string',\n      enum: SEMANTIC_TASK_DECOMPOSITION_STATUSES_V5,\n    },\n    category: { type: 'string', enum: SEMANTIC_TASK_CATEGORIES_V5 },\n",
)
replace_once(
    path,
    "    'When a task is semantically an umbrella or category that naturally contains multiple materially different work items, but the constituent work is not yet stated, emit one uncertainty targeting that task with field work_breakdown. This records unknown task decomposition, not missing quantity. Do not invent constituent work and do not emit it for a task presented as one concrete schedulable unit.',\n",
    "    'Every task must classify decompositionStatus. Use atomic only when the user presents one schedulable work unit or no meaningful planning decomposition is needed. Use decomposed when constituent work is already identified in the semantic result. Use needs_breakdown when the task denotes a collection, project, program, or category containing independently schedulable work whose constituents are still unknown. Do not choose atomic merely because constituents were not stated, and never invent constituents.',\n",
)

# Validator: migration-compatible acceptance, strict validation when field is present.
path = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticValidatorV5.ts'
replace_once(
    path,
    "import type {\n  WeeklyPlanningSemanticDocumentV5,\n} from './weeklyPlanningSemanticDocumentV5';\n",
    "import {\n  SEMANTIC_TASK_DECOMPOSITION_STATUSES_V5,\n  type WeeklyPlanningSemanticDocumentV5,\n} from './weeklyPlanningSemanticDocumentV5';\n",
)
replace_once(
    path,
    "          durableContextSignals: _taskSignals,\n          existingPublicId: _taskExistingPublicId,\n          ...taskRest\n",
    "          durableContextSignals: _taskSignals,\n          existingPublicId: _taskExistingPublicId,\n          decompositionStatus: _taskDecompositionStatus,\n          ...taskRest\n",
)
insert_after = "function validateExistingPublicIds(value: Record<string, unknown>): string[] {\n"
idx_text = Path(path).read_text()
if idx_text.count(insert_after) != 1:
    raise SystemExit('validator insertion anchor mismatch')
validation_fn = """function validateTaskDecompositionStatuses(value: Record<string, unknown>): string[] {
  if (!Array.isArray(value.tasks)) return [];
  const allowed = new Set<unknown>(SEMANTIC_TASK_DECOMPOSITION_STATUSES_V5);
  const errors: string[] = [];
  value.tasks.forEach((task, taskIndex) => {
    if (!isRecord(task) || task.decompositionStatus === undefined) return;
    if (!allowed.has(task.decompositionStatus)) {
      errors.push(`document.tasks[${taskIndex}].decompositionStatus:unsupported-value`);
    }
  });
  return errors;
}

"""
idx_text = idx_text.replace(insert_after, validation_fn + insert_after, 1)
Path(path).write_text(idx_text)
replace_once(
    path,
    "  const existingPublicIdErrors = validateExistingPublicIds(weeklyValue);\n  const signalErrors = validateDurableContextSignals(weeklyValue, baseLocalIds);\n",
    "  const existingPublicIdErrors = validateExistingPublicIds(weeklyValue);\n  const decompositionErrors = validateTaskDecompositionStatuses(weeklyValue);\n  const signalErrors = validateDurableContextSignals(weeklyValue, baseLocalIds);\n",
)
replace_once(
    path,
    "    ...existingPublicIdErrors,\n    ...signalErrors,\n",
    "    ...existingPublicIdErrors,\n    ...decompositionErrors,\n    ...signalErrors,\n",
)

# Normalizer: structurally derive existing uncertainty from explicit task classification.
path = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts'
replace_once(
    path,
    "import {\n  validateWeeklyPlanningRecurrenceConsistencyV5,\n} from './weeklyPlanningRecurrenceConsistencyV5';\n",
    "import {\n  validateWeeklyPlanningRecurrenceConsistencyV5,\n} from './weeklyPlanningRecurrenceConsistencyV5';\nimport {\n  normalizeTaskDecompositionUncertaintiesV5,\n} from './weeklyPlanningTaskDecompositionNormalizationV5';\n",
)
replace_once(
    path,
    "  const copiedContextNormalization = normalizeCopiedUserContextDeltaV5({\n    rawResponse,\n    userText: input.userText,\n    publicStateSummary: input.publicStateSummary,\n  });\n  const componentParentNormalization = normalizeContainingTaskComponentParentV5(\n    copiedContextNormalization.rawResponse,\n  );\n",
    "  const decompositionNormalization = normalizeTaskDecompositionUncertaintiesV5(rawResponse);\n  const copiedContextNormalization = normalizeCopiedUserContextDeltaV5({\n    rawResponse: decompositionNormalization.rawResponse,\n    userText: input.userText,\n    publicStateSummary: input.publicStateSummary,\n  });\n  const componentParentNormalization = normalizeContainingTaskComponentParentV5(\n    copiedContextNormalization.rawResponse,\n  );\n",
)
replace_once(
    path,
    "  const algorithmicRepairs = [\n    ...copiedContextNormalization.repairs,\n",
    "  const algorithmicRepairs = [\n    ...decompositionNormalization.repairs,\n    ...copiedContextNormalization.repairs,\n",
)
