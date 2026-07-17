from pathlib import Path

path = Path('.github/scripts/apply-entrypoint-request-ownership.py')
text = path.read_text(encoding='utf-8')
old = """def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')
"""
new = """def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    print(f'ANCHOR {label}: {count}', flush=True)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')
"""
if text.count(old) != 1:
    raise SystemExit(f'instrument anchor count: {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
