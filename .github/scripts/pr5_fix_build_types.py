from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count == 0 and new in text:
        return
    if count != expected:
        raise RuntimeError(
            f'{path}: expected {expected} matches, found {count}: {old[:120]!r}'
        )
    file.write_text(text.replace(old, new))


replace_exact(
    'src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts',
    "export function nextWeekScope(context: WeeklyPlanningIntakeContext): PendingPlanningRangeClarification['scope'] {",
    "export function nextWeekScope(\n  context: WeeklyPlanningIntakeContext,\n): Extract<PendingPlanningRangeClarification['scope'], { kind: 'next_week' }> {",
)

replace_exact(
    'src/features/weeklyPlanning/intake/weeklyPlanningDateValidation.ts',
    'export function isIsoCalendarDate(value: unknown): value is string {',
    "export function isIsoCalendarDate(value: string): boolean;\nexport function isIsoCalendarDate(value: unknown): value is string;\nexport function isIsoCalendarDate(value: unknown): boolean {",
)

replace_exact(
    'src/features/weeklyPlanning/intake/weeklyPlanningDraftRequestAdapter.ts',
    'state.pendingPlanningRange.scope.startDate',
    'state.pendingPlanningRange.scope.windowStartDate',
    expected=2,
)

replace_exact(
    'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts',
    "\nfunction integerArraySchema(): JsonSchemaObject {\n  return { type: 'array', items: integerSchema() };\n}\n",
    '\n',
)

adapter_test = 'src/features/weeklyPlanning/__tests__/weeklyPlanningDraftRequestAdapter.test.ts'
replace_exact(
    adapter_test,
    "        startDate: '2026-07-20',\n        endDate: '2026-07-26',",
    "        windowStartDate: '2026-07-20',\n        windowEndDate: '2026-07-26',",
)
replace_exact(
    adapter_test,
    'expect(state.pendingPlanningRange?.scope.startDate).toBe',
    'expect(state.pendingPlanningRange?.scope.windowStartDate).toBe',
)
replace_exact(
    adapter_test,
    "scope: { kind: 'next_week' as const, label: '来週', startDate: '2026-07-13', endDate: '2026-07-19' },",
    "scope: {\n          kind: 'next_week' as const,\n          label: '来週',\n          windowStartDate: '2026-07-13',\n          windowEndDate: '2026-07-19',\n        },",
)
replace_exact(
    adapter_test,
    "      scope: {\n        ...withoutScopeStartDate.pendingPlanningRange!.scope,\n        startDate: undefined,\n      },",
    "      scope: {\n        kind: 'named_future_period',\n        label: '夏休み',\n      },",
)

replace_exact(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts',
    "      pendingPlanningRange: {\n        label: '来週',\n        startDate: '2026-07-13',\n        endDate: '2026-07-19',\n      },",
    "      pendingPlanningRange: {\n        kind: 'next_week',\n        label: '来週',\n        windowStartDate: '2026-07-13',\n        windowEndDate: '2026-07-19',\n        durationDays: 7,\n      },",
)

replace_exact(
    'src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.test.ts',
    "          startDate: '2026-07-13',\n          endDate: '2026-07-19',",
    "          windowStartDate: '2026-07-13',\n          windowEndDate: '2026-07-19',",
)

replace_exact(
    'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeAdversarialRegression.test.ts',
    '        command,\n        origin: \'ai_interpreter\',',
    "        command: command as unknown as InterpretedCommandCandidate['command'],\n        origin: 'ai_interpreter',",
)

replace_exact(
    'src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.test.ts',
    "        scope: { kind: 'next_week', label: '来週' },",
    "        scope: {\n          kind: 'next_week',\n          label: '来週',\n          windowStartDate: '2026-07-13',\n          windowEndDate: '2026-07-19',\n        },",
)

pipeline_test = 'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts'
replace_exact(
    pipeline_test,
    "        startDate: '2026-07-20',\n        endDate: '2026-07-26',",
    "        windowStartDate: '2026-07-20',\n        windowEndDate: '2026-07-26',",
)
replace_exact(
    pipeline_test,
    'pending.state.pendingPlanningRange?.scope.startDate',
    'pending.state.pendingPlanningRange?.scope.windowStartDate',
)
replace_exact(
    pipeline_test,
    'pending.state.pendingPlanningRange?.scope.endDate',
    'pending.state.pendingPlanningRange?.scope.windowEndDate',
)
