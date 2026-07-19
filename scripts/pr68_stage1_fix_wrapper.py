from pathlib import Path

source_path = Path('scripts/pr68_stage1_fix.py')
source = source_path.read_text()
old = "next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)"
new = "next_text, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)"
if old not in source:
    raise RuntimeError('regex replacement implementation was not found')
source = source.replace(old, new, 1)
exec(compile(source, str(source_path), 'exec'))
