from pathlib import Path

source_path = Path('scripts/pr68_stage1_fix.py')
source = source_path.read_text()
replacements = [
    (
        "next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)",
        "next_text, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)",
    ),
    (
        """controller_candidates = []
for path in Path('src/features/weeklyPlanning').rglob('*.ts'):
    text = path.read_text()
    if 'submitWeeklyPlanningControlledTurn' in text and 'createWeeklyPlanningControllerSession' in text:
        controller_candidates.append(path)
if len(controller_candidates) != 1:
    raise RuntimeError(f'controller candidates: {controller_candidates}')
controller = controller_candidates[0]
""",
        "controller = Path('src/features/weeklyPlanning/weeklyPlanningTurnController.ts')\n",
    ),
]
for old, new in replacements:
    if old not in source:
        raise RuntimeError(f'wrapper replacement was not found: {old[:80]!r}')
    source = source.replace(old, new, 1)
exec(compile(source, str(source_path), 'exec'))
