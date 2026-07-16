from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BRANCH = 'agent/weekly-planning-conversation-hardening'


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: replacement count={count}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningIntakeTypes.ts',
    "export interface PendingPlanningRangeClarification {\n  scope: {\n    kind: PlanningTemporalScopeKind;\n    label: string;\n    startDate?: string;\n    endDate?: string;\n  };\n  durationDays: number;\n  sourceText: string;\n}\n",
    "interface PendingPlanningTemporalScopeBase {\n  label: string;\n  startDate?: string;\n  endDate?: string;\n}\n\nexport type PendingPlanningRangeClarification =\n  | {\n      scope: PendingPlanningTemporalScopeBase & { kind: 'next_week' };\n      durationDays: number;\n      sourceText: string;\n    }\n  | {\n      scope: PendingPlanningTemporalScopeBase & { kind: 'named_future_period' };\n      durationDays?: number;\n      sourceText: string;\n    };\n",
)

replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts',
    "export function normalizeSetPendingPlanningRangeCommand(\n  command: SetPendingPlanningRangeCommand,\n  context: WeeklyPlanningIntakeContext,\n): NormalizedSetPendingPlanningRangeCommand {\n  const durationDays = command.pending.durationDays ?? 7;\n  if (command.pending.scope.kind !== 'next_week') {\n    return {\n      ...command,\n      pending: { ...command.pending, durationDays },\n    };\n  }\n\n  const referenceDate = context.currentDateTime?.slice(0, 10) || context.selectedDate;\n  const normalizedScope = nextWeekScope({\n    ...context,\n    selectedDate: referenceDate,\n  });\n\n  return {\n    ...command,\n    pending: {\n      ...command.pending,\n      scope: {\n        ...command.pending.scope,\n        startDate: command.pending.scope.startDate ?? normalizedScope.startDate,\n        endDate: command.pending.scope.endDate ?? normalizedScope.endDate,\n      },\n      durationDays,\n    },\n  };\n}\n",
    "export function normalizeSetPendingPlanningRangeCommand(\n  command: SetPendingPlanningRangeCommand,\n  context: WeeklyPlanningIntakeContext,\n): NormalizedSetPendingPlanningRangeCommand {\n  if (command.pending.scope.kind === 'named_future_period') {\n    return {\n      ...command,\n      pending: {\n        ...command.pending,\n        scope: { ...command.pending.scope },\n      },\n    };\n  }\n\n  const durationDays = command.pending.durationDays ?? 7;\n  const referenceDate = context.currentDateTime?.slice(0, 10) || context.selectedDate;\n  const normalizedScope = nextWeekScope({\n    ...context,\n    selectedDate: referenceDate,\n  });\n\n  return {\n    ...command,\n    pending: {\n      ...command.pending,\n      scope: {\n        ...command.pending.scope,\n        startDate: command.pending.scope.startDate ?? normalizedScope.startDate,\n        endDate: command.pending.scope.endDate ?? normalizedScope.endDate,\n      },\n      durationDays,\n    },\n  };\n}\n",
)

replace_once(
    'src/features/weeklyPlanning/weeklyPlanningStorage.ts',
    "  return (value.scope.kind === 'next_week' || value.scope.kind === 'named_future_period')\n    && typeof value.scope.label === 'string'\n    && isOptionalString(value.scope.startDate)\n    && isOptionalString(value.scope.endDate)\n    && isPositiveInteger(value.durationDays)\n    && typeof value.sourceText === 'string';\n",
    "  const commonFieldsAreValid = typeof value.scope.label === 'string'\n    && isOptionalString(value.scope.startDate)\n    && isOptionalString(value.scope.endDate)\n    && typeof value.sourceText === 'string';\n  if (!commonFieldsAreValid) return false;\n  if (value.scope.kind === 'next_week') {\n    return isPositiveInteger(value.durationDays);\n  }\n  if (value.scope.kind === 'named_future_period') {\n    return value.durationDays === undefined || isPositiveInteger(value.durationDays);\n  }\n  return false;\n",
)

replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts',
    "      'invalid-planning-temporal-scope-kind',\n",
    "      'invalid-command-shape',\n",
)
replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts',
    "      'invalid-duration-days',\n",
    "      'invalid-command-shape',\n",
)

replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeCommandContract.test.ts',
    "  it('normalizes an omitted duration for named future periods as well', () => {\n    const normalized = normalizeSetPendingPlanningRangeCommand(\n      commandWithoutDuration('named_future_period'),\n      { selectedDate: '2026-07-16' },\n    );\n    expect(normalized.pending.durationDays).toBe(7);\n  });\n",
    "  it('preserves a named future period without inferring dates or duration', () => {\n    const command = commandWithoutDuration('named_future_period');\n    const normalized = normalizeSetPendingPlanningRangeCommand(\n      command,\n      { selectedDate: '2026-07-16' },\n    );\n    expect(normalized.pending).toEqual(command.pending);\n  });\n\n  it('preserves an explicit named-future duration', () => {\n    const command = commandWithoutDuration('named_future_period');\n    const normalized = normalizeSetPendingPlanningRangeCommand({\n      ...command,\n      pending: { ...command.pending, durationDays: 14 },\n    }, { selectedDate: '2026-07-16' });\n    expect(normalized.pending.durationDays).toBe(14);\n  });\n",
)

replace_once(
    'src/features/weeklyPlanning/weeklyPlanningStorageValidation.test.ts',
    "  it.each(['v2', 'legacy'])('removes session-local proposal records while loading %s data', (format) => {\n",
    "  it('restores a named future period whose duration is still unresolved', () => {\n    const intakeState = {\n      ...createInitialPlanningIntakeState(),\n      pendingPlanningRange: {\n        scope: { kind: 'named_future_period' as const, label: '夏休み' },\n        sourceText: '夏休みの予定',\n      },\n    };\n    storeV2({\n      ...createInitialPlanningState(WEEK_START),\n      revision: 1,\n      intakeState,\n    });\n\n    const loaded = loadWeeklyPlanningState(USER_ID, WEEK_START);\n    expect(loaded.revision).toBe(1);\n    expect(loaded.intakeState?.pendingPlanningRange).toEqual(\n      intakeState.pendingPlanningRange,\n    );\n  });\n\n  it.each(['v2', 'legacy'])('removes session-local proposal records while loading %s data', (format) => {\n",
)

subprocess.run([
    'npm', 'run', 'test:run', '--',
    'src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts',
    'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeCommandContract.test.ts',
    'src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts',
    'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts',
    'src/features/weeklyPlanning/weeklyPlanningStorageValidation.test.ts',
], cwd=ROOT, check=True)
subprocess.run(['npm', 'run', 'build'], cwd=ROOT, check=True)
subprocess.run(['git', 'rm', '-f', 'docs/ai/tasks/20260716-weekly-planning-pr5-full-test-error.log'], cwd=ROOT, check=False)
subprocess.run(['git', 'rm', '-f', 'docs/ai/tasks/20260716-weekly-planning-pr5-n2-regression-error.log'], cwd=ROOT, check=False)
subprocess.run([
    'git', 'add',
    'src/features/weeklyPlanning/intake/weeklyPlanningIntakeTypes.ts',
    'src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts',
    'src/features/weeklyPlanning/weeklyPlanningStorage.ts',
    'src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts',
    'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeCommandContract.test.ts',
    'src/features/weeklyPlanning/weeklyPlanningStorageValidation.test.ts',
], cwd=ROOT, check=True)
subprocess.run(['git', 'commit', '-m', 'feat: pending rangeを判別共用体へ修正'], cwd=ROOT, check=True)
subprocess.run(['git', 'push', 'origin', f'HEAD:{BRANCH}'], cwd=ROOT, check=True)
