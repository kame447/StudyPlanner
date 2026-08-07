from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, got {count}: {old[:140]}')
    p.write_text(text.replace(old, new, 1))

# Typed durable concern basis.
path = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5.ts'
replace_once(
    path,
    "export interface SemanticDurableContextSignalV5 extends SemanticSourceEvidenceV5 {\n  localId: string;\n  kind: 'concern';\n  value: string | null;\n}\n",
    "export const SEMANTIC_DURABLE_CONCERN_BASES_V5 = [\n  'difficulty',\n  'weakness',\n  'worry',\n  'low_confidence',\n  'behind',\n  'motivation_problem',\n] as const;\nexport type SemanticDurableConcernBasisV5 =\n  (typeof SEMANTIC_DURABLE_CONCERN_BASES_V5)[number];\n\nexport interface SemanticDurableContextSignalV5 extends SemanticSourceEvidenceV5 {\n  localId: string;\n  kind: 'concern';\n  basis?: SemanticDurableConcernBasisV5;\n  value: string | null;\n}\n",
)
replace_once(
    path,
    "  required: ['localId', 'kind', 'value', 'sourceText'],\n  properties: {\n    localId: { type: 'string' },\n    kind: { type: 'string', enum: ['concern'] },\n    value: nullableStringSchema,\n",
    "  required: ['localId', 'kind', 'basis', 'value', 'sourceText'],\n  properties: {\n    localId: { type: 'string' },\n    kind: { type: 'string', enum: ['concern'] },\n    basis: { type: 'string', enum: SEMANTIC_DURABLE_CONCERN_BASES_V5 },\n    value: nullableStringSchema,\n",
)
replace_once(
    path,
    "    'Every task and study component must return durableContextSignals, using an empty array when none apply. Emit a concern signal only when current userText explicitly describes a subjective or evaluative continuing difficulty, weakness, worry, confidence problem, being behind, or comparable concern relevant to later plans. A descriptive amount, relative size, frequency, duration, or workload comparison alone is not a concern. Preserve the concern wording in value or use null; do not invent a diagnosis or stronger priority.',\n",
    "    'Every task and study component must return durableContextSignals, using an empty array when none apply. A concern requires one explicit basis: difficulty, weakness, worry, low_confidence, behind, or motivation_problem. If no basis is supported by current userText, emit no concern. Descriptive amount, relative size, frequency, duration, or workload comparison alone supports none of these bases. Preserve the concern wording in value or use null; do not invent a diagnosis or stronger priority.',\n",
)

# Validator accepts omitted basis only for old fixtures/checkpoints, validates any present value.
path = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticValidatorV5.ts'
replace_once(
    path,
    "import {\n  SEMANTIC_TASK_DECOMPOSITION_STATUSES_V5,\n  type WeeklyPlanningSemanticDocumentV5,\n} from './weeklyPlanningSemanticDocumentV5';\n",
    "import {\n  SEMANTIC_DURABLE_CONCERN_BASES_V5,\n  SEMANTIC_TASK_DECOMPOSITION_STATUSES_V5,\n  type WeeklyPlanningSemanticDocumentV5,\n} from './weeklyPlanningSemanticDocumentV5';\n",
)
replace_once(
    path,
    "      if (!hasOnlyKeys(signal, ['localId', 'kind', 'value', 'sourceText'])) {\n",
    "      if (!hasOnlyKeys(signal, ['localId', 'kind', 'basis', 'value', 'sourceText'])) {\n",
)
replace_once(
    path,
    "      if (signal.kind !== 'concern') errors.push(`${signalPath}.kind:unsupported-value`);\n      if (!(signal.value === null || typeof signal.value === 'string')) {\n",
    "      if (signal.kind !== 'concern') errors.push(`${signalPath}.kind:unsupported-value`);\n      if (signal.basis !== undefined\n        && !(SEMANTIC_DURABLE_CONCERN_BASES_V5 as readonly unknown[]).includes(signal.basis)) {\n        errors.push(`${signalPath}.basis:unsupported-value`);\n      }\n      if (!(signal.value === null || typeof signal.value === 'string')) {\n",
)

# Stop decomposition when concrete components exist; ask one component's amount/range.
path = 'src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.ts'
old = """function missingSchedulableWorkQuestion(
  graph: WeeklyPlanningFactGraphV5,
): { message: string; questionCode?: string; taskTitles: string[] } {
  const taskTitles = createWeeklyPlanningActiveSchedulerGraphViewV5(graph).tasks
    .map((task) => task.title.trim())
    .filter(Boolean);
  if (taskTitles.length === 0) {
    return {
      message: '予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。',
      questionCode: 'missing_schedulable_work',
      taskTitles,
    };
  }

  const visibleTitles = taskTitles.slice(0, 3).map((title) => `「${title}」`).join('、');
  const summary = taskTitles.length > 3
    ? `${visibleTitles}など${taskTitles.length}件のタスク`
    : visibleTitles;
  const question = taskTitles.length === 1
    ? 'どこまで進めたいか、量や範囲が決まっていれば教えてください。'
    : 'まず一つずつ整理したいので、どれから決めるか教えてください。選んだものについて、どこまで進めたいか確認します。';
  return {
    message: `${summary}がありますね。${question}`,
    questionCode: 'missing_schedulable_work',
    taskTitles,
  };
}
"""
new = """function missingSchedulableWorkQuestion(
  graph: WeeklyPlanningFactGraphV5,
): { message: string; questionCode?: string; taskTitles: string[] } {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  const taskTitles = active.tasks.map((task) => task.title.trim()).filter(Boolean);
  const componentWithNoWorkload = active.components.find(
    (component) => !active.workloads.some((workload) => workload.componentId === component.id),
  );
  if (componentWithNoWorkload) {
    return {
      message: `「${componentWithNoWorkload.label}」は、どこまで進めたいですか？ページ数・問題数・範囲など、分かる形で教えてください。`,
      questionCode: 'missing_schedulable_work',
      taskTitles,
    };
  }
  const taskWithNoWorkload = active.tasks.find(
    (task) => !active.workloads.some((workload) => workload.taskId === task.id),
  );
  if (taskWithNoWorkload) {
    return {
      message: `「${taskWithNoWorkload.title}」は、どこまで進めたいですか？量や範囲が分かれば教えてください。`,
      questionCode: 'missing_schedulable_work',
      taskTitles,
    };
  }
  return {
    message: '予定に入れる作業量がまだありません。まず一つ、どこまで進めたいか教えてください。',
    questionCode: 'missing_schedulable_work',
    taskTitles,
  };
}
"""
replace_once(path, old, new)

# Renderer must not turn missing quantity into another breakdown question.
path = 'src/features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRenderer.ts'
replace_once(
    path,
    "      'undecidedItemsにfieldがwork_breakdownの項目がある場合は、量や合計時間より先に、その対象の中身を分けるための一つの質問をしてください。',\n",
    "      'undecidedItemsにfieldがwork_breakdownの項目がある場合だけ、その対象の中身を分ける質問をしてください。questionCodeがmissing_schedulable_workの場合は追加の分解を求めず、既に分かっている一つの作業について量・範囲を確認してください。',\n",
)
