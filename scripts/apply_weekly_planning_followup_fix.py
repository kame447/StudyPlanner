from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"expected one replacement in {path}, found {count}")
    file_path.write_text(content.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts",
    """  const normalizedText = normalizeIntakeText(text);
  const fields = uniqueList([...(previousScope?.fields ?? []), ...extractExamFields(text)]);
  const totalFields = parseTotalFields(text) ?? previousScope?.totalFields;
""",
    """  const normalizedText = normalizeIntakeText(text);
  const extractedFields = extractExamFields(text);
  const explicitFieldReplacement = extractedFields.length > 0
    && parseTotalFields(text) === 1
    && /(?:違う|訂正|一科目|1科目|一分野|1分野)/.test(normalizedText);
  const fields = explicitFieldReplacement
    ? uniqueList(extractedFields)
    : uniqueList([...(previousScope?.fields ?? []), ...extractedFields]);
  const totalFields = parseTotalFields(text) ?? previousScope?.totalFields;
""",
)

replace_once(
    "src/features/weeklyPlanning/pipeline/weeklyPlanningRenderedQuestionContext.ts",
    """export function applyRenderedQuestionContext(
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
): WeeklyPlanningBehaviorAwarePipelineOutput {
  if (output.decision.kind === 'answer_clarification') return output;
""",
    """export function applyRenderedQuestionContext(
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
): WeeklyPlanningBehaviorAwarePipelineOutput {
  // Exam flows are rendered from decision.questionPlan after this pipeline returns.
  // Keep the intake pipeline's first-question context instead of overwriting it
  // with behaviorDialogue actions that are not shown to the user.
  if (output.decision.kind === 'answer_clarification' || output.state.examPrepScope) return output;
""",
)
