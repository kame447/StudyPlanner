from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, got {count}: {old[:180]}')
    p.write_text(text.replace(old, new, 1))


path = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts'
replace_once(
    path,
    "import {\n  validateWeeklyPlanningSemanticEvidenceV5,\n} from './weeklyPlanningSemanticEvidenceV5';\n",
    "import {\n  validateWeeklyPlanningSemanticEvidenceV5,\n} from './weeklyPlanningSemanticEvidenceV5';\nimport {\n  validateWeeklyPlanningStandaloneModifierTargetsV5,\n} from './weeklyPlanningStandaloneModifierTargetV5';\n",
)
replace_once(
    path,
    "    ...validateWeeklyPlanningSemanticEvidenceV5({\n      document: parsed.document,\n      input,\n    }),\n",
    "    ...validateWeeklyPlanningSemanticEvidenceV5({\n      document: parsed.document,\n      input,\n    }),\n    ...validateWeeklyPlanningStandaloneModifierTargetsV5({\n      document: parsed.document,\n      userText: input.userText,\n    }),\n",
)
replace_once(
    path,
    "  if (errors.some((error) => error.includes('not-grounded-in-current-user-text'))) {\n",
    "  if (errors.some((error) => error.includes('ambiguous-standalone-modifier-target'))) {\n    directives.push('A standalone modifier after multiple listed candidate tasks/components has no unique target. Remove the guessed modifier attachment. Keep the listed candidates, and emit one uncertainty with field modifier_target and the modifier excerpt as sourceText. Do not choose a candidate by order or proximity.');\n  }\n  if (errors.some((error) => error.includes('not-grounded-in-current-user-text'))) {\n",
)
