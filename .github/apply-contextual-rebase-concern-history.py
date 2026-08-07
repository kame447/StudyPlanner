from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, got {count}: {old[:120]}')
    p.write_text(text.replace(old, new, 1))

# Contextual semantic-document answers must use the same exact-ID rebase as ordinary turns.
replace_once(
    'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPipelineV5.ts',
    "      const entityBindingApplication = contextualAnswer\n        ? {\n            version: 'weekly-planning-existing-entity-binding-application-v5' as const,\n            status: 'not_applicable' as const,\n            canonicalization: baseCanonicalization,\n            errors: [],\n          }\n        : applyWeeklyPlanningExistingEntityBindingsV5({\n            originalGraph: graph,\n            document: normalization.document,\n            canonicalization: baseCanonicalization,\n          });\n",
    "      const contextualDocumentNeedsEntityBinding = Boolean(\n        contextualAnswer && pendingQuestion?.questionCode === 'semantic_uncertainty',\n      );\n      const entityBindingApplication = !contextualAnswer || contextualDocumentNeedsEntityBinding\n        ? applyWeeklyPlanningExistingEntityBindingsV5({\n            originalGraph: graph,\n            document: normalization.document,\n            canonicalization: baseCanonicalization,\n          })\n        : {\n            version: 'weekly-planning-existing-entity-binding-application-v5' as const,\n            status: 'not_applicable' as const,\n            canonicalization: baseCanonicalization,\n            errors: [],\n          };\n",
)

# Durable concern semantics: subjective/evaluative concern only, not descriptive workload magnitude.
replace_once(
    'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5.ts',
    "    'Every task and study component must return durableContextSignals, using an empty array when none apply. When current userText explicitly describes that entity as difficult, weak, worrying, behind, or otherwise an ongoing concern relevant to later plans, emit a concern signal on that entity. Preserve the concern wording in value or use null; do not invent a diagnosis or stronger priority.',\n",
    "    'Every task and study component must return durableContextSignals, using an empty array when none apply. Emit a concern signal only when current userText explicitly describes a subjective or evaluative continuing difficulty, weakness, worry, confidence problem, being behind, or comparable concern relevant to later plans. A descriptive amount, relative size, frequency, duration, or workload comparison alone is not a concern. Preserve the concern wording in value or use null; do not invent a diagnosis or stronger priority.',\n",
)

# Owner context is history: distinct concern values under one entity do not overwrite each other.
replace_once(
    'src/features/userPlanningContext/userPlanningContextSpace.ts',
    "function recordIdentity(fact: UserPlanningContextSemanticFactV1): string {\n  return [\n    fact.kind,\n    normalizeIdentityPart(fact.label),\n    fact.kind === 'goal_event' ? normalizeIdentityPart(fact.dateExpression) : '',\n  ].join('|');\n}\n",
    "function recordIdentity(fact: UserPlanningContextSemanticFactV1): string {\n  return [\n    fact.kind,\n    normalizeIdentityPart(fact.label),\n    fact.kind === 'goal_event'\n      ? normalizeIdentityPart(fact.dateExpression)\n      : normalizeIdentityPart(fact.value),\n  ].join('|');\n}\n",
)
replace_once(
    'src/features/userPlanningContext/userPlanningContextSpace.ts',
    "    const identity = [\n      record.kind,\n      normalizeIdentityPart(record.label),\n      record.kind === 'goal_event' ? normalizeIdentityPart(record.dateExpression) : '',\n    ].join('|');\n",
    "    const identity = [\n      record.kind,\n      normalizeIdentityPart(record.label),\n      record.kind === 'goal_event'\n        ? normalizeIdentityPart(record.dateExpression)\n        : normalizeIdentityPart(record.value),\n    ].join('|');\n",
)
