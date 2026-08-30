from pathlib import Path

hook = Path('src/hooks/usePlannerDataState.ts')
text = hook.read_text()
old = """  function removePlansByIds(current: Plan[], planIds: string[]): Plan[] {\n    const idSet = new Set(planIds);\n    return current.filter((plan) => !idSet.has(plan.id));\n  }\n\n"""
if text.count(old) != 1:
    raise SystemExit(f'hook removePlansByIds anchor mismatch: {text.count(old)}')
hook.write_text(text.replace(old, '', 1))

unavailable = Path('src/repositories/unavailableRepositories.ts')
text = unavailable.read_text()
anchor = """    async getTimetablePeriods() {\n      return [];\n    },\n    async upsertPlan() {"""
replacement = """    async getTimetablePeriods() {\n      return [];\n    },\n    async applyRecurringPlanMutation() {\n      throw createConfigurationError();\n    },\n    async upsertPlan() {"""
if text.count(anchor) != 1:
    raise SystemExit(f'unavailable repository anchor mismatch: {text.count(anchor)}')
unavailable.write_text(text.replace(anchor, replacement, 1))
