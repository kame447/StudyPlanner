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
    'src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts',
    "export function normalizeSetPendingPlanningRangeCommand(\n  command: SetPendingPlanningRangeCommand,\n  context: WeeklyPlanningIntakeContext,\n): NormalizedSetPendingPlanningRangeCommand {\n  const durationDays = command.pending.durationDays ?? 7;\n  if (command.pending.scope.kind !== 'next_week') {\n    return {\n      ...command,\n      pending: { ...command.pending, durationDays },\n    };\n  }\n\n  const referenceDate = context.currentDateTime?.slice(0, 10) || context.selectedDate;\n  const normalizedScope = nextWeekScope({\n    ...context,\n    selectedDate: referenceDate,\n  });\n\n  return {\n    ...command,\n    pending: {\n      ...command.pending,\n      scope: {\n        ...command.pending.scope,\n        startDate: command.pending.scope.startDate ?? normalizedScope.startDate,\n        endDate: command.pending.scope.endDate ?? normalizedScope.endDate,\n      },\n      durationDays,\n    },\n  };\n}\n",
    "export function normalizeSetPendingPlanningRangeCommand(\n  command: SetPendingPlanningRangeCommand,\n  context: WeeklyPlanningIntakeContext,\n): NormalizedSetPendingPlanningRangeCommand | undefined {\n  const durationDays = command.pending.durationDays\n    ?? (command.pending.scope.kind === 'next_week' ? 7 : undefined);\n  if (durationDays === undefined) {\n    return undefined;\n  }\n  if (command.pending.scope.kind !== 'next_week') {\n    return {\n      ...command,\n      pending: { ...command.pending, durationDays },\n    };\n  }\n\n  const referenceDate = context.currentDateTime?.slice(0, 10) || context.selectedDate;\n  const normalizedScope = nextWeekScope({\n    ...context,\n    selectedDate: referenceDate,\n  });\n\n  return {\n    ...command,\n    pending: {\n      ...command.pending,\n      scope: {\n        ...command.pending.scope,\n        startDate: command.pending.scope.startDate ?? normalizedScope.startDate,\n        endDate: command.pending.scope.endDate ?? normalizedScope.endDate,\n      },\n      durationDays,\n    },\n  };\n}\n",
)
replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts',
    "  const parsedCommand: ParsedWeeklyPlanningCommand =\n    normalizedCommand.type === 'set_pending_planning_range'\n      ? normalizeSetPendingPlanningRangeCommand(normalizedCommand, context)\n      : normalizedCommand;\n",
    "  let parsedCommand: ParsedWeeklyPlanningCommand;\n  if (normalizedCommand.type === 'set_pending_planning_range') {\n    const normalizedPendingCommand = normalizeSetPendingPlanningRangeCommand(\n      normalizedCommand,\n      context,\n    );\n    if (!normalizedPendingCommand) {\n      return null;\n    }\n    parsedCommand = normalizedPendingCommand;\n  } else {\n    parsedCommand = normalizedCommand;\n  }\n",
)
replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts',
    "    expect(normalizeSetPendingPlanningRangeCommand(command, {\n      selectedDate: '2026-07-10',\n      currentDateTime: '2026-07-10T15:30:00',\n    })).toBe(command);\n",
    "    expect(normalizeSetPendingPlanningRangeCommand(command, {\n      selectedDate: '2026-07-10',\n      currentDateTime: '2026-07-10T15:30:00',\n    })).toBeUndefined();\n",
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
    "  it('does not infer an omitted duration for named future periods', () => {\n    const normalized = normalizeSetPendingPlanningRangeCommand(\n      commandWithoutDuration('named_future_period'),\n      { selectedDate: '2026-07-16' },\n    );\n    expect(normalized).toBeUndefined();\n  });\n",
)

subprocess.run([
    'npm', 'run', 'test:run', '--',
    'src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts',
    'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeCommandContract.test.ts',
    'src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts',
], cwd=ROOT, check=True)
subprocess.run(['npm', 'run', 'build'], cwd=ROOT, check=True)
subprocess.run(['git', 'rm', '-f', 'docs/ai/tasks/20260716-weekly-planning-pr5-full-test-error.log'], cwd=ROOT, check=False)
subprocess.run([
    'git', 'add',
    'src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts',
    'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts',
    'src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts',
    'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeCommandContract.test.ts',
], cwd=ROOT, check=True)
subprocess.run(['git', 'commit', '-m', 'feat: named future periodの期間推論を防止'], cwd=ROOT, check=True)
subprocess.run(['git', 'push', 'origin', f'HEAD:{BRANCH}'], cwd=ROOT, check=True)
