from pathlib import Path

for path in [
    '.github/workflows/pr68-seven-audit-boundary-fixes.yml',
    'scripts/pr68_seven_audit_boundary_fixes.py',
    'pr68-seven-audit-error.txt',
]:
    Path(path).unlink(missing_ok=True)
