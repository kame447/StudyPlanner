from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:140]!r}')
    file.write_text(text.replace(old, new, 1))


path = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts'
replace_once(
    path,
    "import {\n  normalizeContainingTaskComponentParentV5,\n} from './weeklyPlanningComponentParentNormalizationV5';\n",
    "import {\n"
    "  normalizeContainingTaskComponentParentV5,\n"
    "} from './weeklyPlanningComponentParentNormalizationV5';\n"
    "import {\n"
    "  normalizeCopiedUserContextDeltaV5,\n"
    "} from './weeklyPlanningCopiedUserContextNormalizationV5';\n",
)

old = '''function validateSemanticResponse(
  rawResponse: string,
  input: WeeklyPlanningSemanticNormalizerInputV5,
): SemanticValidationAttemptV5 {
  const componentParentNormalization = normalizeContainingTaskComponentParentV5(rawResponse);
  const workloadNormalization = normalizeExactDuplicateWorkloadPlacementV5(
    componentParentNormalization.rawResponse,
  );
  const algorithmicRepairs = [
    ...componentParentNormalization.repairs,
    ...workloadNormalization.repairs,
  ];
  const parsed = parseWeeklyPlanningSemanticDocumentV5(workloadNormalization.rawResponse);
'''
new = '''function validateSemanticResponse(
  rawResponse: string,
  input: WeeklyPlanningSemanticNormalizerInputV5,
): SemanticValidationAttemptV5 {
  const copiedContextNormalization = normalizeCopiedUserContextDeltaV5({
    rawResponse,
    userText: input.userText,
    publicStateSummary: input.publicStateSummary,
  });
  const componentParentNormalization = normalizeContainingTaskComponentParentV5(
    copiedContextNormalization.rawResponse,
  );
  const workloadNormalization = normalizeExactDuplicateWorkloadPlacementV5(
    componentParentNormalization.rawResponse,
  );
  const algorithmicRepairs = [
    ...copiedContextNormalization.repairs,
    ...componentParentNormalization.repairs,
    ...workloadNormalization.repairs,
  ];
  const parsed = parseWeeklyPlanningSemanticDocumentV5(workloadNormalization.rawResponse);
'''
replace_once(path, old, new)
