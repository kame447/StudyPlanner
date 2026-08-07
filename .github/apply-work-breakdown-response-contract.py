from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, got {count}: {old[:120]}')
    p.write_text(text.replace(old, new, 1))

path = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts'
replace_once(
    path,
    "import {\n  normalizeTaskDecompositionUncertaintiesV5,\n} from './weeklyPlanningTaskDecompositionNormalizationV5';\n",
    "import {\n  normalizeTaskDecompositionUncertaintiesV5,\n} from './weeklyPlanningTaskDecompositionNormalizationV5';\nimport {\n  validateWeeklyPlanningWorkBreakdownResponseContractV5,\n} from './weeklyPlanningWorkBreakdownResponseContractV5';\n",
)
replace_once(
    path,
    "  'For semantic_uncertainty, return only its resolving semantic delta; if still unresolved, emit uncertainty.',\n",
    "  'For semantic_uncertainty, return only its resolving semantic delta; if still unresolved, emit uncertainty.',\n  'When the pending semantic_uncertainty field is work_breakdown, resolve its targetPublicId from publicStateSummary.uncertainties and return only that exact target task using existingPublicId. Represent the current answer as that task\'s present structure; do not repeat unrelated accepted tasks, the accepted planning window, stored user context, or the old uncertainty. Use decomposed when constituents are now identified, atomic when the user clarifies it is one schedulable unit, and needs_breakdown only when the current answer is still insufficient.',\n",
)
replace_once(
    path,
    "  'Priority and ordering are task relations, not clock constraints.',\n",
    "  'Priority and ordering are task relations, not clock constraints. Task relations reference task localIds only. A statement that one item has more or less work is not priority, order, or dependency unless the user explicitly states scheduling priority/order/dependency.',\n",
)
replace_once(
    path,
    "    ...validateWeeklyPlanningRecurrenceConsistencyV5(parsed.document),\n    ...validateWeeklyPlanningSemanticEvidenceV5({\n",
    "    ...validateWeeklyPlanningRecurrenceConsistencyV5(parsed.document),\n    ...validateWeeklyPlanningWorkBreakdownResponseContractV5({\n      document: parsed.document,\n      publicStateSummary: input.publicStateSummary,\n    }),\n    ...validateWeeklyPlanningSemanticEvidenceV5({\n",
)
replace_once(
    path,
    "  if (errors.some((error) => error.includes('explicit-recurrence-missing'))) {\n    directives.push('When a per-occurrence workload explicitly represents daily, weekdays, or weekends repetition, add the matching recurrence targeting the same task/component localId. periodExpression does not replace recurrence.');\n  }\n",
    "  if (errors.some((error) => error.includes('explicit-recurrence-missing'))) {\n    directives.push('When a per-occurrence workload explicitly represents a recurring cadence, add the matching recurrence targeting the same task/component localId. periodExpression does not replace recurrence.');\n  }\n  if (errors.some((error) => error.includes('work-breakdown-'))) {\n    directives.push('This turn answers the pending work_breakdown uncertainty. Return only the exact target task identified by the pending uncertainty targetPublicId, using that ID as existingPublicId. Represent only the current user answer on that task. Do not copy the accepted planning window, unrelated accepted tasks, stored user context, or the old uncertainty. If constituents are identified, use decompositionStatus decomposed and encode them on the target task; if the user clarifies one schedulable unit, use atomic; use needs_breakdown only when the current answer itself remains insufficient.');\n  }\n  if (errors.some((error) => error.includes('document.relations') && (error.includes('fromLocalId') || error.includes('toLocalId')))) {\n    directives.push('Task relations may reference task localIds only. Do not convert a comparison of workload size or amount into priority/order/dependency unless the user explicitly stated that scheduling relation.');\n  }\n",
)
