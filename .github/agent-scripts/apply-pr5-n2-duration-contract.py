from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BRANCH = 'agent/weekly-planning-conversation-hardening'


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: replacement count={text.count(old)}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts',
    "  NoteUncertaintyCommand,\n  SetPriorityPolicyCommand,\n",
    "  NoteUncertaintyCommand,\n  NormalizedSetPendingPlanningRangeCommand,\n  SetPriorityPolicyCommand,\n",
)
replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts',
    "export function normalizeSetPendingPlanningRangeCommand(\n  command: SetPendingPlanningRangeCommand,\n  context: WeeklyPlanningIntakeContext,\n): SetPendingPlanningRangeCommand {\n  if (command.pending.scope.kind !== 'next_week') {\n    return command;\n  }\n\n  const referenceDate = context.currentDateTime?.slice(0, 10) || context.selectedDate;\n  const normalizedScope = nextWeekScope({\n    ...context,\n    selectedDate: referenceDate,\n  });\n\n  return {\n    ...command,\n    pending: {\n      ...command.pending,\n      scope: {\n        ...command.pending.scope,\n        startDate: command.pending.scope.startDate ?? normalizedScope.startDate,\n        endDate: command.pending.scope.endDate ?? normalizedScope.endDate,\n      },\n      durationDays: command.pending.durationDays ?? 7,\n    },\n  };\n}\n",
    "export function normalizeSetPendingPlanningRangeCommand(\n  command: SetPendingPlanningRangeCommand,\n  context: WeeklyPlanningIntakeContext,\n): NormalizedSetPendingPlanningRangeCommand {\n  const durationDays = command.pending.durationDays ?? 7;\n  if (command.pending.scope.kind !== 'next_week') {\n    return {\n      ...command,\n      pending: { ...command.pending, durationDays },\n    };\n  }\n\n  const referenceDate = context.currentDateTime?.slice(0, 10) || context.selectedDate;\n  const normalizedScope = nextWeekScope({\n    ...context,\n    selectedDate: referenceDate,\n  });\n\n  return {\n    ...command,\n    pending: {\n      ...command.pending,\n      scope: {\n        ...command.pending.scope,\n        startDate: command.pending.scope.startDate ?? normalizedScope.startDate,\n        endDate: command.pending.scope.endDate ?? normalizedScope.endDate,\n      },\n      durationDays,\n    },\n  };\n}\n",
)
replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningCommandRuntimeValidation.ts',
    "        || (pending.durationDays !== undefined\n          && (typeof pending.durationDays !== 'number' || !Number.isInteger(pending.durationDays)))) return false;\n      return hasOnlyKeys(pending.scope, ['kind', 'label', 'startDate', 'endDate'])\n        && typeof pending.scope.kind === 'string'\n",
    "        || (pending.durationDays !== undefined\n          && (typeof pending.durationDays !== 'number'\n            || !Number.isInteger(pending.durationDays)\n            || pending.durationDays <= 0))) return false;\n      return hasOnlyKeys(pending.scope, ['kind', 'label', 'startDate', 'endDate'])\n        && (pending.scope.kind === 'next_week' || pending.scope.kind === 'named_future_period')\n",
)

(ROOT / 'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeCommandContract.test.ts').write_text("""import { describe, expect, it } from 'vitest';
import { normalizeSetPendingPlanningRangeCommand } from './weeklyPlanningCommandAdapter';
import {
  canonicalizeOptionalCommandNulls,
  isValidWeeklyPlanningCommand,
} from './weeklyPlanningCommandRuntimeValidation';
import type { SetPendingPlanningRangeCommand } from './weeklyPlanningCommandTypes';

function commandWithoutDuration(
  kind: 'next_week' | 'named_future_period' = 'next_week',
): SetPendingPlanningRangeCommand {
  return {
    type: 'set_pending_planning_range',
    pending: {
      scope: { kind, label: kind === 'next_week' ? '来週' : '次の期間' },
      sourceText: '来週の予定を立てたい',
    },
    sourceText: '来週の予定を立てたい',
    confidence: 'high',
  };
}

describe('pending planning range command contract', () => {
  it('accepts an omitted AI payload duration and normalizes it into required domain state', () => {
    const command = commandWithoutDuration();
    expect(isValidWeeklyPlanningCommand(command)).toBe(true);

    const normalized = normalizeSetPendingPlanningRangeCommand(command, {
      selectedDate: '2026-07-16',
      currentDateTime: '2026-07-16T12:00:00',
    });

    expect(normalized.pending.durationDays).toBe(7);
    expect(normalized.pending.scope.startDate).toBeDefined();
    expect(normalized.pending.scope.endDate).toBeDefined();
  });

  it('normalizes an omitted duration for named future periods as well', () => {
    const normalized = normalizeSetPendingPlanningRangeCommand(
      commandWithoutDuration('named_future_period'),
      { selectedDate: '2026-07-16' },
    );
    expect(normalized.pending.durationDays).toBe(7);
  });

  it.each([0, -1, 1.5])('rejects invalid optional durationDays: %s', (durationDays) => {
    expect(isValidWeeklyPlanningCommand({
      ...commandWithoutDuration(),
      pending: { ...commandWithoutDuration().pending, durationDays },
    })).toBe(false);
  });

  it('rejects planning scope kinds outside the closed union', () => {
    expect(isValidWeeklyPlanningCommand({
      ...commandWithoutDuration(),
      pending: {
        ...commandWithoutDuration().pending,
        scope: { kind: 'invalid', label: '不正' },
      },
    })).toBe(false);
  });

  it('canonicalizes null durationDays to the optional AI payload shape', () => {
    const canonicalized = canonicalizeOptionalCommandNulls({
      ...commandWithoutDuration(),
      pending: { ...commandWithoutDuration().pending, durationDays: null },
    });
    expect(isValidWeeklyPlanningCommand(canonicalized)).toBe(true);
  });
});
""", encoding='utf-8')

subprocess.run([
    'npm', 'run', 'test:run', '--',
    'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeCommandContract.test.ts',
    'src/features/weeklyPlanning/intake/weeklyPlanningCommandRuntimeValidation.test.ts',
    'src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts',
], cwd=ROOT, check=True)
subprocess.run(['npm', 'run', 'build'], cwd=ROOT, check=True)
subprocess.run([
    'git', 'add',
    'src/features/weeklyPlanning/intake/weeklyPlanningCommandAdapter.ts',
    'src/features/weeklyPlanning/intake/weeklyPlanningCommandRuntimeValidation.ts',
    'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeCommandContract.test.ts',
], cwd=ROOT, check=True)
subprocess.run(['git', 'commit', '-m', 'feat: planning range commandの型契約を統一'], cwd=ROOT, check=True)
subprocess.run(['git', 'push', 'origin', f'HEAD:{BRANCH}'], cwd=ROOT, check=True)
