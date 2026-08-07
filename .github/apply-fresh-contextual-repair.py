from pathlib import Path

p = Path('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts')
text = p.read_text()
old = """function createRepairMessages(params: {
  baseMessages: ChatMessage[];
  invalidResponse: string;
  validationErrors: string[];
  input: WeeklyPlanningSemanticNormalizerInputV5;
}): ChatMessage[] {
  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.invalidResponse },
    {
      role: 'user',
      content: JSON.stringify({
        instruction: 'Return the complete corrected Stable V5 JSON document only. Complete means all required JSON Schema top-level keys are present; it does not mean restating the accepted plan. The document must remain a delta for current userText. Do not invent facts or application decisions.',
        requiredChanges: repairDirectivesForErrors(params.validationErrors, params.input),
        validationErrors: params.validationErrors,
      }),
    },
  ];
}
"""
new = """function createRepairMessages(params: {
  baseMessages: ChatMessage[];
  invalidResponse: string;
  validationErrors: string[];
  input: WeeklyPlanningSemanticNormalizerInputV5;
}): ChatMessage[] {
  const repairInstruction: ChatMessage = {
    role: 'user',
    content: JSON.stringify({
      instruction: 'Return the complete corrected Stable V5 JSON document only. Complete means all required JSON Schema top-level keys are present; it does not mean restating the accepted plan. The document must remain a delta for current userText. Do not invent facts or application decisions.',
      requiredChanges: repairDirectivesForErrors(params.validationErrors, params.input),
      validationErrors: params.validationErrors,
    }),
  };
  const freshContextualRepair = Boolean(
    readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5(params.input.publicStateSummary),
  );
  if (freshContextualRepair) {
    return [...params.baseMessages, repairInstruction];
  }
  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.invalidResponse },
    repairInstruction,
  ];
}
"""
if text.count(old) != 1:
    raise SystemExit(f'expected exact repair function once, got {text.count(old)}')
p.write_text(text.replace(old, new, 1))
