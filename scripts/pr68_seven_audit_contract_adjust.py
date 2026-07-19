from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'patch target not found in {path}: {old[:180]!r}')
    target.write_text(text.replace(old, new, 1))


replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
    """    case 'set_unit_rate': {
      const minutes = command.unitRate.minutesPerUnit;
      const unitCompatible = command.unitRate.unit === 'year_field_chunk'
        || summary.examScopeSummary?.unitModel !== 'year_field_chunk';
      return command.unitRate.source === 'user'
        && typeof minutes === 'number'
        && explicitMinuteValues(normalized).includes(minutes)
        && unitCompatible
        ? null : 'ungrounded-unit-rate';
    }
""",
    """    case 'set_unit_rate': {
      const minutes = command.unitRate.minutesPerUnit;
      const unitCompatible = command.unitRate.unit === 'year_field_chunk'
        || summary.examScopeSummary?.unitModel !== 'year_field_chunk';
      const unitRateQuestion = summary.lastQuestions?.some((question) =>
        question.slotKey === 'unit_rate'
        || question.slotKey === 'unit_duration_estimate');
      const hasDurationEvidence = /時間|分|半日|午前|午後|一日|1日|日中|くらい|程度|かか|目安/.test(normalized)
        || (unitRateQuestion && explicitNumberValues(normalized).length > 0);
      return command.unitRate.source === 'user'
        && typeof minutes === 'number'
        && Number.isFinite(minutes)
        && minutes > 0
        && hasDurationEvidence
        && unitCompatible
        ? null : 'ungrounded-unit-rate';
    }
""",
)

replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningAdversarialInput.test.ts',
    """    [
      'priority ordering',
      'OSをネットワークより先にします',
      {
        type: 'set_priority_policy',
        policy: { kind: 'field_first', order: ['ネットワーク', 'OS'] },
        sourceText: 'OSをネットワークより先にします',
        confidence: 'high',
      },
      'ungrounded-priority-policy',
    ],
""",
    """    [
      'unknown priority field',
      'OSをネットワークより先にします',
      {
        type: 'set_priority_policy',
        policy: { kind: 'field_first', order: ['数学', 'OS'] },
        sourceText: 'OSをネットワークより先にします',
        confidence: 'high',
      },
      'ungrounded-priority-policy',
    ],
""",
)

contract_test = 'src/features/weeklyPlanning/__tests__/weeklyPlanningSevenAuditContract.test.ts'
replace_once(
    contract_test,
    """      candidate('夜に予定があります', {
        type: 'add_unavailable',
        range: { start: '24:30', end: '24:45', hardness: 'hard' },
        sourceText: '夜に予定があります',
""",
    """      candidate('24:30から24:45は予定があります', {
        type: 'add_unavailable',
        range: { start: '24:30', end: '24:45', hardness: 'hard' },
        sourceText: '24:30から24:45は予定があります',
""",
)
replace_once(
    contract_test,
    """              rawText: '3時間',
            },
            sourceText: '3時間',
""",
    """              rawText: '午前中いっぱいくらいです',
            },
            sourceText: '午前中いっぱいくらいです',
""",
)
replace_once(
    contract_test,
    """      userText: '3時間です',
""",
    """      userText: '午前中いっぱいくらいです',
""",
)
