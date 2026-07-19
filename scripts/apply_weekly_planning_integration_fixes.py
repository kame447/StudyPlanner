from __future__ import annotations

from pathlib import Path


scope_path = Path(
    "src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts"
)
scope = scope_path.read_text(encoding="utf-8")
old_scope_merge = """  const normalizedText = normalizeIntakeText(text);
  const fields = uniqueList([...(previousScope?.fields ?? []), ...extractExamFields(text)]);
  const totalFields = parseTotalFields(text) ?? previousScope?.totalFields;
"""
new_scope_merge = """  const normalizedText = normalizeIntakeText(text);
  const extractedFields = extractExamFields(text);
  const replacesExistingFields = extractedFields.length > 0
    && /(?:違う|訂正|ではなく|じゃなく|だけ(?:です|だ)?|(?:一|1)\s*科目)/.test(normalizedText);
  const fields = replacesExistingFields
    ? extractedFields
    : uniqueList([...(previousScope?.fields ?? []), ...extractedFields]);
  const totalFields = parseTotalFields(text) ?? previousScope?.totalFields;
"""
if old_scope_merge not in scope:
    raise RuntimeError("exam scope merge target was not found")
scope_path.write_text(
    scope.replace(old_scope_merge, new_scope_merge, 1),
    encoding="utf-8",
)

executor_path = Path(
    "src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts"
)
executor = executor_path.read_text(encoding="utf-8")
old_executor_return = """  const message = isExamFlow
    ? await renderWeeklyPlanningDialogueMessage({
      state: pipelineOutput.state,
      previousState: input.previousState,
      decision: pipelineOutput.decision,
      renderer: dialogueRenderer,
      userId: input.userId,
      existingPlans: input.plans,
    })
    : pipelineOutput.behaviorDialogue.message;

  return {
    state: pipelineOutput.state,
    message,
    draftCandidates: pipelineOutput.draftCandidates ?? [],
  };
"""
new_executor_return = """  const message = isExamFlow
    ? await renderWeeklyPlanningDialogueMessage({
      state: pipelineOutput.state,
      previousState: input.previousState,
      decision: pipelineOutput.decision,
      renderer: dialogueRenderer,
      userId: input.userId,
      existingPlans: input.plans,
    })
    : pipelineOutput.behaviorDialogue.message;
  const firstRenderedQuestion = isExamFlow
    ? pipelineOutput.decision.questionPlan?.[0]
    : undefined;
  const state = firstRenderedQuestion
    ? {
        ...pipelineOutput.state,
        lastQuestionContext: {
          kind: pipelineOutput.decision.kind === 'offer_dry_run_preview' ? 'preview' : 'missing',
          targetSlot: firstRenderedQuestion.targetSlot,
          intent: firstRenderedQuestion.intent,
        },
      }
    : pipelineOutput.state;

  return {
    state,
    message,
    draftCandidates: pipelineOutput.draftCandidates ?? [],
  };
"""
if old_executor_return not in executor:
    raise RuntimeError("turn executor rendered-question context target was not found")
executor_path.write_text(
    executor.replace(old_executor_return, new_executor_return, 1),
    encoding="utf-8",
)
