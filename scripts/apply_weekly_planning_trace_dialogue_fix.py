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
renderer_path.write_text(renderer, encoding="utf-8")
