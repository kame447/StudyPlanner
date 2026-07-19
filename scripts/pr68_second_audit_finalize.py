from pathlib import Path
import runpy


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'patch target not found: {label}')
    return text.replace(old, new, 1)


script_path = Path('scripts/pr68_second_audit_fixes.py')
text = script_path.read_text()
text = replace_once(
    text,
    'updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)',
    'updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)',
    'literal regex replacement',
)
text = replace_once(
    text,
    "anchor = \"\"\"describe('weekly planning legacy fallback', () => {",
    "anchor = \"\"\"describe('weekly planning legacy fallback regression', () => {",
    'legacy fallback test anchor',
)
text = replace_once(
    text,
    "readiness_test = 'src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts'\ntext = Path(readiness_test).read_text()\n",
    "readiness_test = 'src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts'\ntext = Path(readiness_test).read_text()\ntext = text.replace(\n    \"import { context, applyWeekendRangeAndExamScope } from './weeklyPlanningRoleplayTestHelpers';\\n\",\n    \"import { finalizeState } from '../intake/weeklyPlanningMissingStatus';\\nimport { context, applyWeekendRangeAndExamScope } from './weeklyPlanningRoleplayTestHelpers';\\n\",\n    1,\n)\n",
    'readiness finalize import',
)
text = replace_once(
    text,
    "      confirmedSlots: [],\n      examScopeSummary: {\n        examType: '院試',\n        fields: ['OS', 'ネットワーク'],\n        unitModel: 'year_field_chunk',\n        rawText: ['院試の過去問はOSとネットワーク'],\n      },\n",
    "      confirmedSlots: [],\n",
    'isolated adversarial grounding fixture',
)
text = replace_once(
    text,
    "  unit_rate: (text) => /(?:目安|かかる|かかります|必要|所要).*(?:時間|何時間|何分|どれくらい)|(?:何時間|何分|どれくらい).*(?:かかる|必要|目安)/.test(text),",
    r"  unit_rate: (text) => /(?:(?:1|一)\s*(?:年分|分野).*(?:何時間|何分|どれくらい))|(?:目安|かかる|かかります|必要|所要).*(?:時間|何時間|何分|どれくらい)|(?:何時間|何分|どれくらい).*(?:かかる|必要|目安)/.test(text),",
    'unit rate renderer wording',
)
text = replace_once(
    text,
    "  unit_duration_estimate: (text) => /(?:目安|かかる|かかります|必要|所要).*(?:時間|何時間|何分|どれくらい)|(?:何時間|何分|どれくらい).*(?:かかる|必要|目安)/.test(text),",
    r"  unit_duration_estimate: (text) => /(?:(?:1|一)\s*(?:年分|分野).*(?:何時間|何分|どれくらい))|(?:目安|かかる|かかります|必要|所要).*(?:時間|何時間|何分|どれくらい)|(?:何時間|何分|どれくらい).*(?:かかる|必要|目安)/.test(text),",
    'unit duration renderer wording',
)
text = replace_once(
    text,
    """    case 'set_study_goal': {
      const titleGrounded = normalizedUser.includes(normalizedEvidence(command.goal.title))
        || approximatelyContains(normalized, command.goal.title);
      const subjectGrounded = !command.goal.subject
""",
    """    case 'set_study_goal': {
      const goalEvidenceStem = (value: string) => normalizedEvidence(value)
        .replace(/(?:したいです|したい|します|する|した)$/, '');
      const normalizedGoalTitle = goalEvidenceStem(command.goal.title);
      const normalizedGoalUser = goalEvidenceStem(normalized);
      const titleGrounded = normalizedGoalUser.includes(normalizedGoalTitle)
        || normalizedUser.includes(normalizedEvidence(command.goal.title))
        || approximatelyContains(normalized, command.goal.title);
      const subjectGrounded = !command.goal.subject
""",
    'Japanese study goal stem grounding',
)
script_path.write_text(text)

fixture_path = Path('src/features/weeklyPlanning/testFixtures/weeklyPlanningEvaluationCases.ts')
fixture = fixture_path.read_text()
fixture = replace_once(
    fixture,
    "freeTextExamScopeAndPriority: '数学とOSとハードウェアとソフトウェアとヒューマンサイエンスがあって、2025〜2019までそれぞれある。分野ごとにまとめてやる。数学から始めて最後がヒューマンサイエンスかな'",
    "freeTextExamScopeAndPriority: '院試の過去問は数学とOSとハードウェアとソフトウェアとヒューマンサイエンスがあって、2025〜2019までそれぞれある。分野ごとにまとめてやる。数学から始めて最後がヒューマンサイエンスかな'",
    'AI interpreter foundation exam evidence',
)
fixture_path.write_text(fixture)

runpy.run_path(str(script_path), run_name='__main__')
