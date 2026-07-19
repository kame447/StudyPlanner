from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'patch target not found in {path}: {old[:220]!r}')
    target.write_text(text.replace(old, new, 1))


validator = 'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts'
replace_once(
    validator,
    """function addDays(date: string, days: number): string {
""",
    """function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

function priorityHeadGrounded(userText: string, field: string | undefined): boolean {
  if (!field) return false;
  const normalized = normalizedEvidence(userText);
  const escapedField = escapeRegExp(normalizedEvidence(field));
  return [
    new RegExp(`${escapedField}を.{0,30}(?:優先|先に)`),
    new RegExp(`(?:優先|先に).{0,20}${escapedField}`),
    new RegExp(`より${escapedField}を.{0,15}先`),
    new RegExp(`${escapedField}から(?:進め|やり|解き|始め)`),
    new RegExp(`${escapedField}.{0,15}(?:苦手|弱点|締切|期限|配点)`),
    new RegExp(`(?:苦手|弱点|締切|期限|配点).{0,15}${escapedField}`),
  ].some((pattern) => pattern.test(normalized));
}

const LIFE_CONSTRAINT_KIND_PATTERNS: Record<
  Extract<ParsedWeeklyPlanningCommand, { type: 'update_life_constraint' }>['kind'],
  RegExp
> = {
  sleep: /睡眠|寝|就寝|起床/,
  meal: /食事|朝食|昼食|夕食|ご飯|食べ/,
  bath: /風呂|入浴|シャワー/,
  commute: /移動|通学|通勤|帰宅|登校/,
  club: /部活|部活動|サークル/,
  cram_school: /塾|予備校/,
  buffer: /休憩|準備|余裕|バッファ/,
};

function lifeConstraintKindGrounded(
  kind: Extract<ParsedWeeklyPlanningCommand, { type: 'update_life_constraint' }>['kind'],
  userText: string,
  summary: InterpreterStateSummary,
): boolean {
  if (LIFE_CONSTRAINT_KIND_PATTERNS[kind].test(userText)) return true;
  return kind === 'sleep'
    && Boolean(summary.lastQuestions?.some((question) => question.slotKey === 'sleep_cycle'));
}

function addDays(date: string, days: number): string {
""",
)

replace_once(
    validator,
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
        && hasDurationEvidence
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
      const explicitMinutes = explicitMinuteValues(normalized);
      const explicitValueGrounded = explicitMinutes.length === 0
        || (typeof minutes === 'number' && explicitMinutes.includes(minutes));
      return command.unitRate.source === 'user'
        && typeof minutes === 'number'
        && hasDurationEvidence
        && explicitValueGrounded
        && unitCompatible
        ? null : 'ungrounded-unit-rate';
    }
""",
)

replace_once(
    validator,
    """    case 'set_priority_policy': {
      if (!/優先|順番|先に|から.*(?:進め|やり|解き|始め)|締切|期限|苦手|弱点|配点|均等|バランス/.test(normalized)) {
        return 'ungrounded-priority-policy';
      }
      if (command.policy.kind !== 'field_first') return null;
      const normalizedKnownFields = new Set(summary.knownFields.map(normalizedEvidence));
      const orderIsStructurallyValid = command.policy.order.length > 0
        && new Set(command.policy.order).size === command.policy.order.length
        && (summary.knownFields.length === 0
          || command.policy.order.every((field) => normalizedKnownFields.has(normalizedEvidence(field))));
      return orderIsStructurallyValid ? null : 'ungrounded-priority-policy';
    }
""",
    """    case 'set_priority_policy': {
      if (!/優先|順番|先に|から.*(?:進め|やり|解き|始め)|締切|期限|苦手|弱点|配点|均等|バランス/.test(normalized)) {
        return 'ungrounded-priority-policy';
      }
      if (command.policy.kind !== 'field_first') return null;
      const normalizedKnownFields = new Set(summary.knownFields.map(normalizedEvidence));
      const orderIsStructurallyValid = command.policy.order.length > 0
        && new Set(command.policy.order).size === command.policy.order.length
        && (summary.knownFields.length === 0
          || command.policy.order.every((field) => normalizedKnownFields.has(normalizedEvidence(field))));
      if (!orderIsStructurallyValid) return 'ungrounded-priority-policy';
      const explicitlyMentionedFields = command.policy.order.filter((field) =>
        normalizedUser.includes(normalizedEvidence(field)));
      return explicitlyMentionedFields.length === 0
        || priorityHeadGrounded(normalized, command.policy.order[0])
        ? null : 'ungrounded-priority-policy';
    }
""",
)

replace_once(
    validator,
    """    case 'update_life_constraint':
      return /\\d{1,2}\\s*時|\\d{1,2}:\\d{2}|睡眠|寝|食事|夕食|風呂|入浴|移動|バイト|授業|予定/.test(normalized)
        && lifeConstraintPayloadGrounded({ userText: normalized, ...command.constraint })
        ? null : 'ungrounded-life-constraint';
""",
    """    case 'update_life_constraint':
      return lifeConstraintKindGrounded(command.kind, normalized, summary)
        && lifeConstraintPayloadGrounded({ userText: normalized, ...command.constraint })
        ? null : 'ungrounded-life-constraint';
""",
)

adversarial = 'src/features/weeklyPlanning/__tests__/weeklyPlanningAdversarialInput.test.ts'
replace_once(
    adversarial,
    """    [
      'unit-rate range',
      '3時間です',
      {
        type: 'set_unit_rate',
        unitRate: {
          unit: 'year_field_chunk',
          minutesPerUnit: 0,
          source: 'user',
        },
        sourceText: '3時間です',
        confidence: 'high',
      },
      'invalid-unit-rate-minutes',
    ],
""",
    """    [
      'unit-rate value',
      '3時間です',
      {
        type: 'set_unit_rate',
        unitRate: {
          unit: 'year_field_chunk',
          minutesPerUnit: 30,
          source: 'user',
        },
        sourceText: '3時間です',
        confidence: 'high',
      },
      'ungrounded-unit-rate',
    ],
    [
      'unit-rate range',
      '3時間です',
      {
        type: 'set_unit_rate',
        unitRate: {
          unit: 'year_field_chunk',
          minutesPerUnit: 0,
          source: 'user',
        },
        sourceText: '3時間です',
        confidence: 'high',
      },
      'invalid-unit-rate-minutes',
    ],
""",
)

replace_once(
    adversarial,
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
    [
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

replace_once(
    adversarial,
    """    [
      'unknown priority field',
""",
    """    [
      'life-constraint kind',
      '23時から7時まで寝ます',
      {
        type: 'update_life_constraint',
        kind: 'meal',
        constraint: {
          start: '23:00',
          end: '07:00',
          hardness: 'hard',
        },
        sourceText: '23時から7時まで寝ます',
        confidence: 'high',
      },
      'ungrounded-life-constraint',
    ],
    [
      'unknown priority field',
""",
)
