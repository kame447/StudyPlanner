from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} match(es), found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new))


semantic = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5.ts'
replace_exact(
    semantic,
    "export interface SemanticSourceEvidenceV5 {\n  sourceText: string;\n}\n\nexport interface SemanticWorkloadV5",
    "export interface SemanticSourceEvidenceV5 {\n  sourceText: string;\n}\n\n"
    "export interface SemanticDurableContextSignalV5 extends SemanticSourceEvidenceV5 {\n"
    "  localId: string;\n"
    "  kind: 'concern';\n"
    "  value: string | null;\n"
    "}\n\n"
    "export interface SemanticWorkloadV5",
)
replace_exact(
    semantic,
    "  label: string;\n  workloads: SemanticWorkloadV5[];\n}",
    "  label: string;\n  workloads: SemanticWorkloadV5[];\n"
    "  durableContextSignals?: SemanticDurableContextSignalV5[];\n}",
)
replace_exact(
    semantic,
    "  temporalConstraints: SemanticTemporalConstraintV5[];\n  recurrence: SemanticRecurrenceV5[];\n}\n\nexport interface SemanticPlanningWindowV5",
    "  temporalConstraints: SemanticTemporalConstraintV5[];\n"
    "  recurrence: SemanticRecurrenceV5[];\n"
    "  durableContextSignals?: SemanticDurableContextSignalV5[];\n"
    "}\n\nexport interface SemanticPlanningWindowV5",
)
replace_exact(
    semantic,
    "const componentSchema = {",
    "const durableContextSignalSchema = {\n"
    "  type: 'object',\n"
    "  additionalProperties: false,\n"
    "  required: ['localId', 'kind', 'value', 'sourceText'],\n"
    "  properties: {\n"
    "    localId: { type: 'string' },\n"
    "    kind: { type: 'string', enum: ['concern'] },\n"
    "    value: nullableStringSchema,\n"
    "    ...sourceTextProperty,\n"
    "  },\n"
    "} as const;\n\n"
    "const componentSchema = {",
)
replace_exact(
    semantic,
    "  required: ['localId', 'parentLocalId', 'role', 'label', 'workloads', 'sourceText'],",
    "  required: [\n"
    "    'localId',\n"
    "    'parentLocalId',\n"
    "    'role',\n"
    "    'label',\n"
    "    'workloads',\n"
    "    'durableContextSignals',\n"
    "    'sourceText',\n"
    "  ],",
)
replace_exact(
    semantic,
    "    label: { type: 'string' },\n    workloads: { type: 'array', items: workloadSchema },\n    ...sourceTextProperty,",
    "    label: { type: 'string' },\n"
    "    workloads: { type: 'array', items: workloadSchema },\n"
    "    durableContextSignals: { type: 'array', items: durableContextSignalSchema },\n"
    "    ...sourceTextProperty,",
)
replace_exact(
    semantic,
    "    'temporalConstraints',\n    'recurrence',\n    'sourceText',",
    "    'temporalConstraints',\n"
    "    'recurrence',\n"
    "    'durableContextSignals',\n"
    "    'sourceText',",
)
replace_exact(
    semantic,
    "    temporalConstraints: { type: 'array', items: temporalConstraintSchema },\n    recurrence: { type: 'array', items: recurrenceSchema },\n    ...sourceTextProperty,",
    "    temporalConstraints: { type: 'array', items: temporalConstraintSchema },\n"
    "    recurrence: { type: 'array', items: recurrenceSchema },\n"
    "    durableContextSignals: { type: 'array', items: durableContextSignalSchema },\n"
    "    ...sourceTextProperty,",
)
replace_exact(
    semantic,
    "    'Use userContextFacts for owner-level context useful beyond the current week. After mapping weekly facts, independently check current userText for every explicit future event occurrence and every explicit ongoing difficulty, weakness, concern, or priority that can matter in later plans. Use goal_event for dated future events and concern for ongoing concerns or priorities; concern has null dateExpression.',\n"
    "    'A concern may coexist with a task or component for the same subject or activity. Do not omit durable concern merely because its label already appears in weekly facts. Preserve the user wording in value or use null; do not invent a diagnosis or stronger priority.',\n"
    "    'userContextFacts are current-turn deltas, not a copy of stored user context. Preserve label, optional value/dateExpression, and sourceText without inventing detail.',",
    "    'Every task and study component must return durableContextSignals, using an empty array when none apply. When current userText explicitly describes that entity as difficult, weak, worrying, behind, or otherwise an ongoing concern relevant to later plans, emit a concern signal on that entity. Preserve the concern wording in value or use null; do not invent a diagnosis or stronger priority.',\n"
    "    'Entity-local concern signals may coexist with the same task/component weekly facts. Do not omit a concern merely because the entity label already appears elsewhere in the document.',\n"
    "    'Use top-level userContextFacts for owner-level context not naturally represented as an entity annotation, especially dated future goal_event occurrences. userContextFacts and durableContextSignals are current-turn deltas, never copies of stored user context.',",
)

validator = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticValidatorV5.ts'
replace_exact(
    validator,
    "function collectLocalIds(value: unknown, ids = new Set<string>()): Set<string> {",
    "function stripDurableContextSignals(value: Record<string, unknown>): Record<string, unknown> {\n"
    "  const tasks = Array.isArray(value.tasks)\n"
    "    ? value.tasks.map((task) => {\n"
    "        if (!isRecord(task)) return task;\n"
    "        const { durableContextSignals: _taskSignals, ...taskRest } = task;\n"
    "        if (!isRecord(taskRest.study) || !Array.isArray(taskRest.study.components)) {\n"
    "          return taskRest;\n"
    "        }\n"
    "        const components = taskRest.study.components.map((component) => {\n"
    "          if (!isRecord(component)) return component;\n"
    "          const { durableContextSignals: _componentSignals, ...componentRest } = component;\n"
    "          return componentRest;\n"
    "        });\n"
    "        return {\n"
    "          ...taskRest,\n"
    "          study: { ...taskRest.study, components },\n"
    "        };\n"
    "      })\n"
    "    : value.tasks;\n"
    "  return { ...value, tasks };\n"
    "}\n\n"
    "function collectLocalIds(value: unknown, ids = new Set<string>()): Set<string> {",
)
replace_exact(
    validator,
    "function validateUserContextFacts(\n  value: unknown,\n  occupiedLocalIds: Set<string>,\n): string[] {",
    "function validateDurableContextSignals(\n"
    "  value: Record<string, unknown>,\n"
    "  occupiedLocalIds: Set<string>,\n"
    "): string[] {\n"
    "  if (!Array.isArray(value.tasks)) return [];\n"
    "  const errors: string[] = [];\n"
    "  const seen = new Set(occupiedLocalIds);\n"
    "  const validateSignals = (signalsValue: unknown, path: string): void => {\n"
    "    if (signalsValue === undefined) return;\n"
    "    if (!Array.isArray(signalsValue)) {\n"
    "      errors.push(`${path}:expected-array`);\n"
    "      return;\n"
    "    }\n"
    "    signalsValue.forEach((signal, index) => {\n"
    "      const signalPath = `${path}[${index}]`;\n"
    "      if (!isRecord(signal)) {\n"
    "        errors.push(`${signalPath}:expected-object`);\n"
    "        return;\n"
    "      }\n"
    "      if (!hasOnlyKeys(signal, ['localId', 'kind', 'value', 'sourceText'])) {\n"
    "        errors.push(`${signalPath}:unknown-key`);\n"
    "      }\n"
    "      if (typeof signal.localId !== 'string' || !signal.localId.trim()) {\n"
    "        errors.push(`${signalPath}.localId:expected-non-empty-string`);\n"
    "      } else if (seen.has(signal.localId)) {\n"
    "        errors.push(`${signalPath}.localId:duplicate-local-id`);\n"
    "      } else {\n"
    "        seen.add(signal.localId);\n"
    "      }\n"
    "      if (signal.kind !== 'concern') errors.push(`${signalPath}.kind:unsupported-value`);\n"
    "      if (!(signal.value === null || typeof signal.value === 'string')) {\n"
    "        errors.push(`${signalPath}.value:expected-string-or-null`);\n"
    "      }\n"
    "      if (typeof signal.sourceText !== 'string' || !signal.sourceText.trim()) {\n"
    "        errors.push(`${signalPath}.sourceText:expected-non-empty-string`);\n"
    "      }\n"
    "    });\n"
    "  };\n"
    "  value.tasks.forEach((task, taskIndex) => {\n"
    "    if (!isRecord(task)) return;\n"
    "    validateSignals(task.durableContextSignals, `document.tasks[${taskIndex}].durableContextSignals`);\n"
    "    if (!isRecord(task.study) || !Array.isArray(task.study.components)) return;\n"
    "    task.study.components.forEach((component, componentIndex) => {\n"
    "      if (!isRecord(component)) return;\n"
    "      validateSignals(\n"
    "        component.durableContextSignals,\n"
    "        `document.tasks[${taskIndex}].study.components[${componentIndex}].durableContextSignals`,\n"
    "      );\n"
    "    });\n"
    "  });\n"
    "  return errors;\n"
    "}\n\n"
    "function validateUserContextFacts(\n"
    "  value: unknown,\n"
    "  occupiedLocalIds: Set<string>,\n"
    "): string[] {",
)
replace_exact(
    validator,
    "  const weeklyValue = Object.fromEntries(\n    Object.entries(value).filter(([key]) => key !== 'userContextFacts'),\n  );\n  const legacy = validateLegacySemanticValueV5(weeklyValue);",
    "  const weeklyValue = Object.fromEntries(\n"
    "    Object.entries(value).filter(([key]) => key !== 'userContextFacts'),\n"
    "  );\n"
    "  const legacyWeeklyValue = stripDurableContextSignals(weeklyValue);\n"
    "  const legacy = validateLegacySemanticValueV5(legacyWeeklyValue);",
)
replace_exact(
    validator,
    "    (error) => !isValidWorkloadEffortTargetError(error, weeklyValue),\n  );\n  const contextErrors = validateUserContextFacts(\n    value.userContextFacts ?? [],\n    collectLocalIds(weeklyValue),\n  );\n  const structuralErrors = [...legacyErrors, ...contextErrors];",
    "    (error) => !isValidWorkloadEffortTargetError(error, legacyWeeklyValue),\n"
    "  );\n"
    "  const baseLocalIds = collectLocalIds(legacyWeeklyValue);\n"
    "  const signalErrors = validateDurableContextSignals(weeklyValue, baseLocalIds);\n"
    "  const contextErrors = validateUserContextFacts(\n"
    "    value.userContextFacts ?? [],\n"
    "    collectLocalIds(weeklyValue),\n"
    "  );\n"
    "  const structuralErrors = [...legacyErrors, ...signalErrors, ...contextErrors];",
)

evidence = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticEvidenceV5.ts'
replace_exact(
    evidence,
    "    ...component.workloads.map((workload, index) => ({\n      path: `${path}.workloads[${index}].sourceText`,\n      sourceText: workload.sourceText,\n    })),\n  ];",
    "    ...component.workloads.map((workload, index) => ({\n"
    "      path: `${path}.workloads[${index}].sourceText`,\n"
    "      sourceText: workload.sourceText,\n"
    "    })),\n"
    "    ...(component.durableContextSignals ?? []).map((signal, index) => ({\n"
    "      path: `${path}.durableContextSignals[${index}].sourceText`,\n"
    "      sourceText: signal.sourceText,\n"
    "    })),\n"
    "  ];",
)
replace_exact(
    evidence,
    "    ...task.recurrence.map((recurrence, index) => ({\n      path: `${path}.recurrence[${index}].sourceText`,\n      sourceText: recurrence.sourceText,\n    })),\n    ...(task.study?.components ?? []).flatMap",
    "    ...task.recurrence.map((recurrence, index) => ({\n"
    "      path: `${path}.recurrence[${index}].sourceText`,\n"
    "      sourceText: recurrence.sourceText,\n"
    "    })),\n"
    "    ...(task.durableContextSignals ?? []).map((signal, index) => ({\n"
    "      path: `${path}.durableContextSignals[${index}].sourceText`,\n"
    "      sourceText: signal.sourceText,\n"
    "    })),\n"
    "    ...(task.study?.components ?? []).flatMap",
)
replace_exact(
    evidence,
    "function userContextEvidence(\n  document: WeeklyPlanningSemanticDocumentV5,\n): SourceEvidenceEntryV5[] {\n  return (document.userContextFacts ?? []).map((fact, index) => ({\n    path: `document.userContextFacts[${index}].sourceText`,\n    sourceText: fact.sourceText,\n  }));\n}",
    "function userContextEvidence(\n"
    "  document: WeeklyPlanningSemanticDocumentV5,\n"
    "): SourceEvidenceEntryV5[] {\n"
    "  return [\n"
    "    ...(document.userContextFacts ?? []).map((fact, index) => ({\n"
    "      path: `document.userContextFacts[${index}].sourceText`,\n"
    "      sourceText: fact.sourceText,\n"
    "    })),\n"
    "    ...document.tasks.flatMap((task, taskIndex) => [\n"
    "      ...(task.durableContextSignals ?? []).map((signal, index) => ({\n"
    "        path: `document.tasks[${taskIndex}].durableContextSignals[${index}].sourceText`,\n"
    "        sourceText: signal.sourceText,\n"
    "      })),\n"
    "      ...(task.study?.components ?? []).flatMap((component, componentIndex) =>\n"
    "        (component.durableContextSignals ?? []).map((signal, index) => ({\n"
    "          path: `document.tasks[${taskIndex}].study.components[${componentIndex}].durableContextSignals[${index}].sourceText`,\n"
    "          sourceText: signal.sourceText,\n"
    "        }))),\n"
    "    ]),\n"
    "  ];\n"
    "}",
)

runtime = 'src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.ts'
replace_exact(
    runtime,
    "import {\n  stageUserPlanningContextFactsV1,\n  userPlanningContextPromptSummaryV1,\n} from '../../userPlanningContext/userPlanningContextSpace';\n",
    "import {\n"
    "  stageUserPlanningContextFactsV1,\n"
    "  userPlanningContextPromptSummaryV1,\n"
    "} from '../../userPlanningContext/userPlanningContextSpace';\n"
    "import {\n"
    "  collectUserPlanningContextFactsV5,\n"
    "} from '../semantic/weeklyPlanningDurableContextSignalsV5';\n",
)
replace_exact(
    runtime,
    "  const userContextFacts = semantic.normalization.document?.userContextFacts ?? [];",
    "  const userContextFacts = semantic.normalization.document\n"
    "    ? collectUserPlanningContextFactsV5(semantic.normalization.document)\n"
    "    : [];",
)
