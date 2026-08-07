from pathlib import Path

p = Path('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts')
text = p.read_text()

def one(old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected 1 match, got {count}: {old[:100]}')
    text = text.replace(old, new, 1)

one(
"import {\n  validateWeeklyPlanningWorkBreakdownResponseContractV5,\n} from './weeklyPlanningWorkBreakdownResponseContractV5';\n",
"import {\n  readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5,\n  validateWeeklyPlanningWorkBreakdownResponseContractV5,\n} from './weeklyPlanningWorkBreakdownResponseContractV5';\n",
)
one(
"    ...validateWeeklyPlanningWorkBreakdownResponseContractV5({\n      document: parsed.document,\n      publicStateSummary: input.publicStateSummary,\n    }),\n",
"    ...validateWeeklyPlanningWorkBreakdownResponseContractV5({\n      document: parsed.document,\n      userText: input.userText,\n      publicStateSummary: input.publicStateSummary,\n    }),\n",
)
one(
"function repairDirectivesForErrors(errors: string[]): string[] {\n  const directives: string[] = [];\n",
"function repairDirectivesForErrors(\n  errors: string[],\n  input: WeeklyPlanningSemanticNormalizerInputV5,\n): string[] {\n  const directives: string[] = [];\n  const pendingWorkBreakdownTarget =\n    readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5(input.publicStateSummary);\n  if (pendingWorkBreakdownTarget) {\n    directives.push(`This turn answers the pending work_breakdown uncertainty for exact target ${pendingWorkBreakdownTarget}. Return exactly one task, bind it with existingPublicId to that target, and use current-userText evidence on that task. Put newly identified study constituents on that target task and mark it decomposed. Do not emit extra top-level tasks, prior planning state, old uncertainty, user context, or task relations in this focused resolution delta.`);\n  }\n",
)
one(
"function createRepairMessages(params: {\n  baseMessages: ChatMessage[];\n  invalidResponse: string;\n  validationErrors: string[];\n}): ChatMessage[] {\n",
"function createRepairMessages(params: {\n  baseMessages: ChatMessage[];\n  invalidResponse: string;\n  validationErrors: string[];\n  input: WeeklyPlanningSemanticNormalizerInputV5;\n}): ChatMessage[] {\n",
)
one(
"        requiredChanges: repairDirectivesForErrors(params.validationErrors),\n",
"        requiredChanges: repairDirectivesForErrors(params.validationErrors, params.input),\n",
)
one(
"      const repairMessages = createRepairMessages({\n        baseMessages,\n        invalidResponse: initialResponse,\n        validationErrors: initialValidation.errors,\n      });\n",
"      const repairMessages = createRepairMessages({\n        baseMessages,\n        invalidResponse: initialResponse,\n        validationErrors: initialValidation.errors,\n        input,\n      });\n",
)

p.write_text(text)
