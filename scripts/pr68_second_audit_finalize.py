from pathlib import Path
import re
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
text = replace_once(
    text,
    "        || /院試|過去問|年度|年分/.test(normalized);",
    "        || /院試|過去問|年度|年分|20\\d{2}\\s*[〜~-]\\s*20\\d{2}/.test(normalized);",
    'year-field unit model evidence',
)
script_path.write_text(text)

fixture_path = Path('src/features/weeklyPlanning/testFixtures/weeklyPlanningEvaluationCases.ts')
fixture = fixture_path.read_text()
fixture, exam_type_count = re.subn(
    r"^\s+examType: '院試',\n",
    '',
    fixture,
    flags=re.MULTILINE,
)
if exam_type_count < 2:
    raise RuntimeError(f'unexpected AI foundation examType fixture count: {exam_type_count}')
fixture_path.write_text(fixture)

interpreter_test_path = Path('src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts')
interpreter_test = interpreter_test_path.read_text()
interpreter_test = replace_once(
    interpreter_test,
    "      userText: '全体を先におさらいしたい',",
    "      userText: '院試全体を先におさらいしたい',",
    'study goal subject evidence fixture',
)
interpreter_test_path.write_text(interpreter_test)

runpy.run_path(str(script_path), run_name='__main__')
