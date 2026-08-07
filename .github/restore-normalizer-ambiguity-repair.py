from pathlib import Path
import subprocess

PATH = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts'
BASE = 'e2b66d6aa4c23b48146bc4710540f361159baa41'

clean = subprocess.check_output(['git', 'show', f'{BASE}:{PATH}'], text=True)
old = "    directives.push('A standalone modifier after multiple listed candidate tasks/components has no unique target. Remove the guessed modifier attachment. Keep the listed candidates, and emit one uncertainty with field modifier_target and the modifier excerpt as sourceText. Do not choose a candidate by order or proximity.');"
new = "    directives.push('A standalone modifier after multiple listed candidate tasks/components has no unique target. Preserve every otherwise-valid current-turn fact from the invalid response, including its planningWindow and listed tasks/components, but remove the guessed modifier attachment only. Emit exactly one uncertainty for that modifier with targetLocalId exactly \\\"document\\\", field exactly \\\"modifier_target\\\", and the modifier excerpt as sourceText. Never use null or the string \\\"null\\\" for targetLocalId, and do not choose a candidate by order or proximity.');"

count = clean.count(old)
if count != 1:
    raise SystemExit(f'expected exactly one repair directive in clean base, found {count}')

Path(PATH).write_text(clean.replace(old, new, 1))
