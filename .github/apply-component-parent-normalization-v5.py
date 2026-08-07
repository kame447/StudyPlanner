from pathlib import Path


def replace_exact(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1))


normalizer = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts'
replace_exact(
    normalizer,
    "import {\n  normalizeExactDuplicateWorkloadPlacementV5,\n} from './weeklyPlanningDuplicateWorkloadNormalizationV5';\n",
    "import {\n"
    "  normalizeContainingTaskComponentParentV5,\n"
    "} from './weeklyPlanningComponentParentNormalizationV5';\n"
    "import {\n"
    "  normalizeExactDuplicateWorkloadPlacementV5,\n"
    "} from './weeklyPlanningDuplicateWorkloadNormalizationV5';\n",
)

old_validate = '''function validateSemanticResponse(
  rawResponse: string,
  input: WeeklyPlanningSemanticNormalizerInputV5,
): SemanticValidationAttemptV5 {
  const rawNormalization = normalizeExactDuplicateWorkloadPlacementV5(rawResponse);
  const parsed = parseWeeklyPlanningSemanticDocumentV5(rawNormalization.rawResponse);
  if (!parsed.document) {
    return {
      document: null,
      parsedDocument: null,
      errors: parsed.errors,
      algorithmicRepairs: rawNormalization.repairs,
    };
  }

  const errors = [
    ...planningWindowCanonicalValueErrors(parsed.document.planningWindow),
    ...validateWeeklyPlanningSemanticEvidenceV5({
      document: parsed.document,
      input,
    }),
  ];
  return {
    document: errors.length === 0 ? parsed.document : null,
    parsedDocument: parsed.document,
    errors,
    algorithmicRepairs: rawNormalization.repairs,
  };
}
'''
new_validate = '''function validateSemanticResponse(
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
  if (!parsed.document) {
    return {
      document: null,
      parsedDocument: null,
      errors: parsed.errors,
      algorithmicRepairs,
    };
  }

  const errors = [
    ...planningWindowCanonicalValueErrors(parsed.document.planningWindow),
    ...validateWeeklyPlanningSemanticEvidenceV5({
      document: parsed.document,
      input,
    }),
  ];
  return {
    document: errors.length === 0 ? parsed.document : null,
    parsedDocument: parsed.document,
    errors,
    algorithmicRepairs,
  };
}
'''
replace_exact(normalizer, old_validate, new_validate)

semantic = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5.ts'
replace_exact(
    semantic,
    'Represent subjects, fields, materials, topics, chapters, sections, and skills as components. Use parentLocalId for hierarchy.',
    'Represent subjects, fields, materials, topics, chapters, sections, and skills as components. parentLocalId is only for component-to-component hierarchy inside the same task: top-level components use null, child components use another component localId, and a task localId must never be used as parentLocalId.',
)
