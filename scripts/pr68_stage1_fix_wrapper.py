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
    (
        "if (!sourceTextIsGrounded(candidate, command)) return 'ungrounded-source-text';",
        "if (command.sourceSegment && !sourceTextIsGrounded(candidate, command)) return 'ungrounded-source-segment';",
    ),
    (
        "/勉強|学習|課題|ワーク|過去問|進め|やり|解き|復習|暗記/.test(normalized)",
        "/勉強|学習|課題|ワーク|過去問|進め|やり|解き|復習|暗記|おさらい|取り組/.test(normalized)",
    ),
    (
        "/優先|順番|先に|から.*(?:進め|やり|解き)/.test(normalized)",
        "/優先|順番|先に|から.*(?:進め|やり|解き|始め)/.test(normalized)",
    ),
]
for old, new in replacements:
    if old not in source:
        raise RuntimeError(f'wrapper replacement was not found: {old[:100]!r}')
    source = source.replace(old, new, 1)
exec(compile(source, str(source_path), 'exec'))

test_path = Path('src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts')
test_source = test_path.read_text()
old = "userText: '実AI応答',"
new = "userText: `来週、${WEEKLY_PLANNING_INTAKE_EVALUATION_CASES.aiInterpreterFoundation.freeTextExamScopeAndPriority}`,"
if old not in test_source:
    raise RuntimeError('generic AI interpreter test input was not found')
test_path.write_text(test_source.replace(old, new))
