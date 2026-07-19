from __future__ import annotations

from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    content = path.read_text(encoding="utf-8")
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one replacement, found {count}")
    path.write_text(content.replace(old, new, 1), encoding="utf-8")


scope_path = Path(
    "src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts"
)
replace_once(
    scope_path,
    """  return uniqueList([...sectionFields, ...extractInlineExamFields(text)]);
""",
    """  return sectionFields.length > 0
    ? uniqueList(sectionFields)
    : extractInlineExamFields(text);
""",
    "exam field extraction precedence",
)
replace_once(
    scope_path,
    """  const normalizedText = normalizeIntakeText(text);
  const fields = uniqueList([...(previousScope?.fields ?? []), ...extractExamFields(text)]);
  const totalFields = parseTotalFields(text) ?? previousScope?.totalFields;
""",
    """  const normalizedText = normalizeIntakeText(text);
  const extractedFields = extractExamFields(text);
  const replacesExistingFields = extractedFields.length > 0
    && /(?:違う|訂正|ではなく|じゃなく|だけ(?:です|だ)?|(?:一|1)\s*科目)/.test(normalizedText);
  const fields = replacesExistingFields
    ? extractedFields
    : uniqueList([...(previousScope?.fields ?? []), ...extractedFields]);
  const totalFields = parseTotalFields(text) ?? previousScope?.totalFields;
""",
    "exam scope correction merge",
)

executor_path = Path(
    "src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts"
)
replace_once(
    executor_path,
    """  const message = isExamFlow
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
""",
    """  const message = isExamFlow
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
""",
    "turn executor rendered-question context",
)
