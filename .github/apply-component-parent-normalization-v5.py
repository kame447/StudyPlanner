from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} match(es), found {count}: {old[:140]!r}')
    p.write_text(text.replace(old, new))


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
replace_exact(
    normalizer,
    "  const rawNormalization = normalizeExactDuplicateWorkloadPlacementV5(rawResponse);\n"
    "  const parsed = parseWeeklyPlanningSemanticDocumentV5(rawNormalization.rawResponse);",
    "  const componentParentNormalization = normalizeContainingTaskComponentParentV5(rawResponse);\n"
    "  const workloadNormalization = normalizeExactDuplicateWorkloadPlacementV5(\n"
    "    componentParentNormalization.rawResponse,\n"
    "  );\n"
    "  const algorithmicRepairs = [\n"
    "    ...componentParentNormalization.repairs,\n"
    "    ...workloadNormalization.repairs,\n"
    "  ];\n"
    "  const parsed = parseWeeklyPlanningSemanticDocumentV5(workloadNormalization.rawResponse);",
)
replace_exact(
    normalizer,
    "      algorithmicRepairs: rawNormalization.repairs,",
    "      algorithmicRepairs,",
    expected=2,
)

semantic = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5.ts'
replace_exact(
    semantic,
    "Represent subjects, fields, materials, topics, chapters, sections, and skills as components. Use parentLocalId for hierarchy.",
    "Represent subjects, fields, materials, topics, chapters, sections, and skills as components. parentLocalId is only for component-to-component hierarchy inside the same task: top-level components use null, child components use another component localId, and a task localId must never be used as parentLocalId.",
)
