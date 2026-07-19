from __future__ import annotations

import subprocess
from pathlib import Path

ORIGINAL_COMMIT = "d5d25965c16750cc96f675da5e0b5958ea12d96a"
ORIGINAL_PATH = "scripts/apply_weekly_planning_trace_dialogue_fix.py"

source = subprocess.check_output(
    ["git", "show", f"{ORIGINAL_COMMIT}:{ORIGINAL_PATH}"],
    text=True,
)
source = source.replace(
    """    '- For Japanese exam years like 2025〜2019, set yearRange.startYear to 2025 and endYear to 2019.',
""",
    """    'For Japanese exam years like 2025〜2019, set yearRange.startYear to 2025 and endYear to 2019.',
""",
    1,
)
target = '''    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
'''
replacement = '''    old = old.replace("\\r?\\n", r"\\r?\\n")
    new = new.replace("\\r?\\n", r"\\r?\\n")
    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
'''
if target not in source:
    raise RuntimeError("applicator normalization target was not found")

patched_source = source.replace(target, replacement, 1)
exec(
    compile(patched_source, str(Path(__file__)), "exec"),
    {"__name__": "__main__", "__file__": __file__},
)

renderer_path = Path(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts"
)
renderer = renderer_path.read_text(encoding="utf-8")
unused_blocks = [
    """  const priorityOrder = params.state.priorityPolicy.kind === 'field_first'
    ? params.state.priorityPolicy.order
    : undefined;
""",
    """function constraintSummary(state: PlanningIntakeState): string[] | undefined {
  const values = state.constraints.map((constraint) =>
    [constraint.kind, constraint.date, constraint.start, constraint.end]
      .filter(Boolean)
      .join(' '),
  );

  return values.length > 0 ? values : undefined;
}

""",
]
for block in unused_blocks:
    if block not in renderer:
        raise RuntimeError(f"renderer cleanup target was not found: {block[:80]!r}")
    renderer = renderer.replace(block, "", 1)

replacements = [
    (
        """function planningPeriodLabel(
  state: PlanningIntakeState,
  latestTurn: string,
): string | undefined {
  const source = state.range?.sourceText;
  if (source && !acceptedFromLatestTurn(source, latestTurn)) return undefined;
""",
        """function planningPeriodLabel(
  state: PlanningIntakeState,
  latestTurn?: string,
): string | undefined {
  const source = state.range?.sourceText;
  if (source && latestTurn && !acceptedFromLatestTurn(source, latestTurn)) return undefined;
""",
    ),
    (
        """  const latestTurn = params.state.sourceTurns.at(-1) ?? '';
  const unitRate = params.state.unitRates.find((rate) =>
    typeof rate.minutesPerUnit === 'number'
    && acceptedFromLatestTurn(rate.rawText, latestTurn),
  );
""",
        """  const latestTurn = params.state.sourceTurns.at(-1) ?? '';
  const useTurnDelta = Boolean(params.previousState);
  const unitRate = params.state.unitRates.find((rate) =>
    typeof rate.minutesPerUnit === 'number'
    && (!useTurnDelta || acceptedFromLatestTurn(rate.rawText, latestTurn)),
  );
""",
    ),
    (
        """  const commandGoalTitles = params.state.tasks
    .filter((task) => task.source === 'command' && acceptedFromLatestTurn(task.rawText, latestTurn))
    .map((task) => task.title);
  const examScopeAcceptedThisTurn = params.state.examPrepScope?.rawText.some(
    (sourceText) => acceptedFromLatestTurn(sourceText, latestTurn),
  ) ?? false;
""",
        """  const commandGoalTitles = params.state.tasks
    .filter((task) => task.source === 'command'
      && (!useTurnDelta || acceptedFromLatestTurn(task.rawText, latestTurn)))
    .map((task) => task.title);
  const examScopeAcceptedThisTurn = !useTurnDelta || (params.state.examPrepScope?.rawText.some(
    (sourceText) => acceptedFromLatestTurn(sourceText, latestTurn),
  ) ?? false);
""",
    ),
    (
        """  const mentionsConstraintSource = /時間割|予定表|登録済みの予定|保存済みの予定/.test(latestTurn);

  return {
    planningPeriodLabel: planningPeriodLabel(params.state, latestTurn),
""",
        """  const mentionsConstraintSource = !useTurnDelta
    || /時間割|予定表|登録済みの予定|保存済みの予定/.test(latestTurn);
  const acceptedConstraintSummary = params.state.constraints
    .filter((constraint) => !useTurnDelta || acceptedFromLatestTurn(constraint.rawText, latestTurn))
    .map((constraint) => [constraint.kind, constraint.date, constraint.start, constraint.end]
      .filter(Boolean)
      .join(' '));

  return {
    planningPeriodLabel: planningPeriodLabel(params.state, useTurnDelta ? latestTurn : undefined),
""",
    ),
    (
        """      yearRange: params.state.examPrepScope?.yearRange
        && latestTurn.includes(params.state.examPrepScope.yearRange.sourceText)
""",
        """      yearRange: params.state.examPrepScope?.yearRange
        && (!useTurnDelta || latestTurn.includes(params.state.examPrepScope.yearRange.sourceText))
""",
    ),
    (
        """      constraintSummary: params.state.constraints
        .filter((constraint) => acceptedFromLatestTurn(constraint.rawText, latestTurn))
        .map((constraint) => [constraint.kind, constraint.date, constraint.start, constraint.end]
          .filter(Boolean)
          .join(' ')),
""",
        """      constraintSummary: acceptedConstraintSummary.length > 0
        ? acceptedConstraintSummary
        : undefined,
""",
    ),
    (
        """    fields.length
      ? input.acceptedFacts.totalFields === 1 && fields.length === 1
        ? `${fieldList}を1科目`
        : `${fieldList}の${fields.length}分野`
      : null,
""",
        """    fields.length
      ? input.acceptedFacts.totalFields === 1 && fields.length === 1
        ? `${fieldList}を1科目`
        : fields.length === 1
          ? `対象分野は${fieldList}`
          : `${fieldList}の${fields.length}分野`
      : null,
""",
    ),
]
for old, new in replacements:
    if old not in renderer:
        raise RuntimeError(f"renderer compatibility target was not found: {old[:100]!r}")
    renderer = renderer.replace(old, new, 1)
renderer_path.write_text(renderer, encoding="utf-8")

regression_path = Path(
    "src/features/weeklyPlanning/__tests__/weeklyPlanningObservedConversationRegression.test.ts"
)
regression = regression_path.read_text(encoding="utf-8")
regression = regression.replace(
    "'3時間ぐらいです\n予定は特にないです'",
    r"'3時間ぐらいです\n予定は特にないです'",
)
regression_path.write_text(regression, encoding="utf-8")

question_slots_test_path = Path(
    "src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.test.ts"
)
question_slots_test = question_slots_test_path.read_text(encoding="utf-8")
old_expected = "'週末で優先する分野や進める順番を教えてください。'"
new_expected = "'来週で優先する分野や進める順番を教えてください。'"
if old_expected not in question_slots_test:
    raise RuntimeError("priority question expectation was not found")
question_slots_test_path.write_text(
    question_slots_test.replace(old_expected, new_expected, 1),
    encoding="utf-8",
)
