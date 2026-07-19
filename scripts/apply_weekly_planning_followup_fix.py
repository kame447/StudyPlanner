from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"expected one replacement in {path}, found {count}")
    file_path.write_text(content.replace(old, new, 1), encoding="utf-8")


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
