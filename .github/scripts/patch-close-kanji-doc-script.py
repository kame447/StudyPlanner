from pathlib import Path

path = Path('.github/scripts/close-kanji-absolute-date-task.py')
text = path.read_text(encoding='utf-8')
old = """    '- PR #24 completion record: [20260717-weekly-planning-period-short-answer-and-sunday-boundary.md](tasks/closed/20260717-weekly-planning-period-short-answer-and-sunday-boundary.md)\\n',
    '- PR #24 completion record: [20260717-weekly-planning-period-short-answer-and-sunday-boundary.md](tasks/closed/20260717-weekly-planning-period-short-answer-and-sunday-boundary.md)\\n'
    '- PR #26 completion record: [20260717-weekly-planning-kanji-absolute-date-guard.md](tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md)\\n',
"""
new = """    'PR #24 completion record: [20260717-weekly-planning-period-short-answer-and-sunday-boundary.md](tasks/closed/20260717-weekly-planning-period-short-answer-and-sunday-boundary.md)\\n',
    'PR #24 completion record: [20260717-weekly-planning-period-short-answer-and-sunday-boundary.md](tasks/closed/20260717-weekly-planning-period-short-answer-and-sunday-boundary.md)\\n'
    'PR #26 completion record: [20260717-weekly-planning-kanji-absolute-date-guard.md](tasks/closed/20260717-weekly-planning-kanji-absolute-date-guard.md)\\n',
"""
if text.count(old) != 1:
    raise SystemExit(f'contract completion patch anchor count: {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
