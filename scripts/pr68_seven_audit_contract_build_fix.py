from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'patch target not found in {path}: {old[:180]!r}')
    target.write_text(text.replace(old, new, 1))


validator = 'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts'
replace_once(
    validator,
    """    case 'add_unavailable':
      if (command.range.date && !isDate(command.range.date)) return 'invalid-date';
      if (command.range.start && !isTime(command.range.start)) return 'invalid-time';
      if (command.range.end && !isTime(command.range.end)) return 'invalid-time';
      if (command.range.durationMinutes !== undefined && !isReasonableMinutes(command.range.durationMinutes)) {
        return 'invalid-duration-minutes';
      }
      return null;
""",
    """    case 'add_unavailable':
      if (command.range.date && !isDate(command.range.date)) return 'invalid-date';
      if (command.range.start && !isTime(command.range.start)) return 'invalid-time';
      if (command.range.end && !isTime(command.range.end)) return 'invalid-time';
      return null;
""",
)

contract_test = 'src/features/weeklyPlanning/__tests__/weeklyPlanningSevenAuditContract.test.ts'
replace_once(
    contract_test,
    """      interpretUserTurn: vi.fn(async () => ({
""",
    """      interpretUserTurn: vi.fn(async (): ReturnType<WeeklyPlanningIntakeInterpreter['interpretUserTurn']> => ({
""",
)
