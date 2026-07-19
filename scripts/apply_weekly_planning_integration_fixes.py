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
    """    normalizedText.match(/分野(?:は|が|を)?\s*(.+?)(?=だけ(?:です|だ)?|です|$)/)?.[1],
""",
    """    normalizedText.match(/(?:対象)?分野(?:は|が|を)\s*(.+?)(?=だけ(?:です|だ)?|です|$)/)?.[1],
""",
    "inline exam field declaration",
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
    """function parseTotalFields(text: string): number | undefined {
  const match = normalizeIntakeText(text).match(/([0-9]+|[一二三四五六七八九十]+)\s*(?:分野|科目)/);
  return match ? parseSmallInteger(match[1]) : undefined;
}
""",
    """function parseTotalFields(text: string): number | undefined {
  const normalizedText = normalizeIntakeText(text);
  if (/(?:1|一)\s*分野\s*(?:あたり|の\s*(?:1|一)?\s*年分)/.test(normalizedText)) {
    return undefined;
  }
  const match = normalizedText.match(/([0-9]+|[一二三四五六七八九十]+)\s*(?:分野|科目)/);
  return match ? parseSmallInteger(match[1]) : undefined;
}
""",
    "exam field count versus unit-rate expression",
)
replace_once(
    scope_path,
    """function hasExamScopeSignal(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);
  return /院試|分野|科目|20\d{2}\s*[〜~-]\s*20\d{2}|第\s*\d+\s*部/.test(normalizedText)
    || Boolean(parseTotalYears(normalizedText));
}
""",
    """function hasExamScopeSignal(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);
  const fieldDeclaration = /(?:対象)?分野(?:は|が|を)|分野ごと|(?:[0-9]+|[一二三四五六七八九十]+)\s*分野(?!\s*(?:あたり|の\s*(?:1|一)?\s*年分))|(?:[0-9]+|[一二三四五六七八九十]+)\s*科目|第\s*\d+\s*部/.test(normalizedText);
  return /院試|20\d{2}\s*[〜~-]\s*20\d{2}/.test(normalizedText)
    || fieldDeclaration
    || Boolean(parseTotalYears(normalizedText));
}
""",
    "exam scope signal versus unit-rate expression",
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
