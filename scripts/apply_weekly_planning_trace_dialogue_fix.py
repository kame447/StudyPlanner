from __future__ import annotations

import subprocess
from pathlib import Path

ORIGINAL_COMMIT = "d5d25965c16750cc96f675da5e0b5958ea12d96a"
ORIGINAL_PATH = "scripts/apply_weekly_planning_trace_dialogue_fix.py"

source = subprocess.check_output(
    ["git", "show", f"{ORIGINAL_COMMIT}:{ORIGINAL_PATH}"],
    text=True,
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
