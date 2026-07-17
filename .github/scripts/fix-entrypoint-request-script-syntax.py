from pathlib import Path

path = Path('.github/scripts/apply-entrypoint-request-ownership.py')
text = path.read_text(encoding='utf-8')
old = """""",
""",
'remove duplicate pending matcher')"""
new = """""",
'',
'remove duplicate pending matcher')"""
if text.count(old) != 1:
    raise SystemExit(f'empty replacement syntax anchor count: {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
