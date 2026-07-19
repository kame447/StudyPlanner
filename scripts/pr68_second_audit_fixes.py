from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'pattern not found in {path}: {old[:200]!r}')
    target.write_text(text.replace(old, new, 1))


def regex_replace_once(path: str, pattern: str, replacement: str) -> None:
    target = Path(path)
    text = target.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'regex pattern matched {count} times in {path}: {pattern[:200]!r}')
    target.write_text(updated)


# ---------------------------------------------------------------------------
# 1. Dialogue accepted-fact rendering: compare semantic state, not substrings.
# ---------------------------------------------------------------------------
renderer_path = 'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts'
regex_replace_once(
    renderer_path,
    r"function normalizedTurnText\(value: string \| undefined\): string \{.*?\n\}\n\nfunction unitRateBasisLabel",
    """function sameSemanticValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function planningRangeSemanticValue(state: PlanningIntakeState): unknown {
  return {
    range: state.range
      ? {
          startDateTime: state.range.startDateTime,
          endDateTime: state.range.endDateTime,
          calendarDayCount: state.range.calendarDayCount,
          confidence: state.range.confidence,
        }
      : undefined,
    pending: state.pendingPlanningRange
      ? {
          scope: state.pendingPlanningRange.scope,
          planningStartDate: state.pendingPlanningRange.planningStartDate,
          planningStartDateTime: state.pendingPlanningRange.planningStartDateTime,
          durationDays: state.pendingPlanningRange.durationDays,
          planningEndDateTime: state.pendingPlanningRange.planningEndDateTime,
        }
      : undefined,
  };
}

function planningPeriodLabel(
  state: PlanningIntakeState,
  previousState?: PlanningIntakeState,
): string | undefined {
  if (previousState && sameSemanticValue(
    planningRangeSemanticValue(state),
    planningRangeSemanticValue(previousState),
  )) {
    return undefined;
  }

  const source = state.range?.sourceText;
  if (source) {
    if (/来週/.test(source)) return '来週';
    if (/今週/.test(source)) return '今週';
    if (/週末|土日/.test(source)) return '週末';
    if (/今日/.test(source)) return '今日';
  }

  if (!state.range && state.pendingPlanningRange) {
    return state.pendingPlanningRange.scope.label;
  }

  return undefined;
}

function taskSemanticValue(task: PlanningIntakeState['tasks'][number]): unknown {
  return {
    title: task.title,
    subject: task.subject,
    examType: task.examType,
    field: task.field,
    year: task.year,
    unit: task.unit,
    amount: task.amount,
    requiresTimeEstimate: task.requiresTimeEstimate,
    source: task.source,
  };
}

function unitRateSemanticValue(rate: PlanningIntakeState['unitRates'][number]): unknown {
  return {
    unit: rate.unit,
    minutesPerUnit: rate.minutesPerUnit,
    source: rate.source,
    uncertainty: rate.uncertainty,
  };
}

function constraintSemanticValue(
  constraint: PlanningIntakeState['constraints'][number],
): unknown {
  return {
    kind: constraint.kind,
    date: constraint.date,
    start: constraint.start,
    end: constraint.end,
    durationMinutes: constraint.durationMinutes,
    studyAvailableStart: constraint.studyAvailableStart,
    hardness: constraint.hardness,
  };
}

function isNewSemanticItem<T>(
  item: T,
  previousItems: readonly T[],
  semanticValue: (value: T) => unknown,
): boolean {
  const currentValue = semanticValue(item);
  return !previousItems.some((previous) =>
    sameSemanticValue(currentValue, semanticValue(previous)));
}

function unitRateBasisLabel""",
)

regex_replace_once(
    renderer_path,
    r"export function createDialogueRenderInput\(params: \{.*?\n\}\n\nfunction isDialogueRenderOutput",
    """export function createDialogueRenderInput(params: {
  state: PlanningIntakeState;
  previousState?: PlanningIntakeState;
  decision: WeeklyPlanningDialogueDecision;
  existingPlans?: Plan[];
}): DialogueRenderInput {
  const previousTasks = params.previousState?.tasks ?? [];
  const previousUnitRates = params.previousState?.unitRates ?? [];
  const previousConstraints = params.previousState?.constraints ?? [];
  const priorityOrder = params.state.priorityPolicy.kind === 'field_first'
    ? params.state.priorityPolicy.order
    : undefined;
  const unitRate = params.state.unitRates.find((rate) =>
    typeof rate.minutesPerUnit === 'number'
    && isNewSemanticItem(rate, previousUnitRates, unitRateSemanticValue),
  );
  const commandGoalTitles = params.state.tasks
    .filter((task) => task.source === 'command'
      && isNewSemanticItem(task, previousTasks, taskSemanticValue))
    .map((task) => task.title);
  const currentFields = {
    fields: params.state.examPrepScope?.fields ?? [],
    totalFields: params.state.examPrepScope?.totalFields,
  };
  const previousFields = {
    fields: params.previousState?.examPrepScope?.fields ?? [],
    totalFields: params.previousState?.examPrepScope?.totalFields,
  };
  const examScopeAcceptedThisTurn = !params.previousState
    || !sameSemanticValue(currentFields, previousFields);
  const yearRangeAcceptedThisTurn = !params.previousState
    || !sameSemanticValue(
      params.state.examPrepScope?.yearRange
        ? {
            startYear: params.state.examPrepScope.yearRange.startYear,
            endYear: params.state.examPrepScope.yearRange.endYear,
          }
        : undefined,
      params.previousState.examPrepScope?.yearRange
        ? {
            startYear: params.previousState.examPrepScope.yearRange.startYear,
            endYear: params.previousState.examPrepScope.yearRange.endYear,
          }
        : undefined,
    );
  const constraintSourcesChanged = !params.previousState
    || !sameSemanticValue(
      params.state.constraintSourcesInUse ?? [],
      params.previousState.constraintSourcesInUse ?? [],
    );
  const knownFixedEventSummaries = createKnownFixedEventSummaries(
    params.existingPlans ?? [],
    params.state.range,
  );

  const nextQuestions = nextQuestionsFromDecision(
    params.decision,
    2,
    unitRateBasisLabel(params.state),
  );
  const repeatedTargetSlot = params.previousState?.lastQuestionContext?.targetSlot;
  const shouldRepairRepeatedQuestion = Boolean(
    repeatedTargetSlot && nextQuestions[0]?.slotKey === repeatedTargetSlot,
  );
  const renderedQuestions = shouldRepairRepeatedQuestion
    ? [{ ...nextQuestions[0], questionKind: 'repair' }]
    : nextQuestions;
  const acceptedConstraintSummary = params.state.constraints
    .filter((constraint) =>
      isNewSemanticItem(constraint, previousConstraints, constraintSemanticValue))
    .map((constraint) => [constraint.kind, constraint.date, constraint.start, constraint.end]
      .filter(Boolean)
      .join(' '));

  return {
    planningPeriodLabel: planningPeriodLabel(params.state, params.previousState),
    unitRateBasisLabel: unitRateBasisLabel(params.state),
    constraintSourcesInUse: constraintSourcesChanged
      ? constraintSourcesInUseLabels(params.state)
      : undefined,
    knownFixedEventSummaries: knownFixedEventSummaries.length > 0
      ? knownFixedEventSummaries
      : undefined,
    acceptedFacts: {
      fields: examScopeAcceptedThisTurn ? params.state.examPrepScope?.fields : undefined,
      totalFields: examScopeAcceptedThisTurn ? params.state.examPrepScope?.totalFields : undefined,
      goals: commandGoalTitles.length > 0 ? commandGoalTitles : undefined,
      yearRange: yearRangeAcceptedThisTurn && params.state.examPrepScope?.yearRange
        ? {
            startYear: params.state.examPrepScope.yearRange.startYear,
            endYear: params.state.examPrepScope.yearRange.endYear,
          }
        : undefined,
      unitRateMinutes: unitRate?.minutesPerUnit,
      unitRateDisplay: unitRate && typeof unitRate.minutesPerUnit === 'number'
        ? unitRateDisplayLabel(unitRate.rawText, unitRate.minutesPerUnit)
        : undefined,
      priorityOrder: priorityPolicyChanged(params.state.priorityPolicy, params.previousState?.priorityPolicy)
        ? priorityOrder
        : undefined,
      constraintSummary: acceptedConstraintSummary.length > 0
        ? acceptedConstraintSummary
        : undefined,
    },
    assumptions: [...params.state.assumptions],
    nextQuestions: renderedQuestions,
    styleConstraints: { tone: 'mentor', maxQuestions: shouldRepairRepeatedQuestion ? 1 : 2 },
  };
}

function isDialogueRenderOutput""",
)

replace_once(
    renderer_path,
    """const DIALOGUE_FORBIDDEN_CONTENT = /https?:\\/\\/|(?:パスワード|暗証番号|秘密情報|APIキー|アクセストークン|設定画面|外部サイト|リンクを開|貼り付けて|送信して)/i;
const QUESTION_GROUNDING_PATTERNS: Record<string, RegExp> = {
  planning_period: /いつ|期間|今週|来週|週末|開始|終わり/,
  planning_start_date: /いつ|何日|開始|始め/,
  planning_duration: /何日|期間|どれくらい|週間/,
  tasks_or_goals: /何を|勉強|学習|課題|進め/,
  fixed_events: /予定|固定|動かせない|外せない/,
  sleep_cycle: /睡眠|寝|起き|勉強を始め/,
  meal_bath_constraints: /食事|夕食|風呂|入浴/,
  life_constraints: /予定|睡眠|食事|風呂|時間/,
  year_range: /年度|何年|対象年/,
  progress: /どこまで|進捗|終|年度/,
  completion_direction: /終わらせ|進め|どこまで/,
  unit_rate: /時間|分|目安/,
  unit_duration_estimate: /時間|分|目安/,
  priority_policy: /優先|順番|先/,
  next_field_after_math: /次|分野|科目/,
};

function isGroundedDialogueQuestion(planned: DialogueNextQuestion, text: string): boolean {
  const normalized = stripGenericAcknowledgementPrefix(text).replace(/\\s+/g, ' ').trim();
  if (!normalized || normalized.length > 240 || DIALOGUE_FORBIDDEN_CONTENT.test(normalized)) {
    return false;
  }
  const slotPattern = QUESTION_GROUNDING_PATTERNS[planned.slotKey];
  if (slotPattern?.test(normalized)) return true;
  const hintTokens = (planned.vocabularyHint ?? '')
    .split(/[\\s、。・／/やをのにへはがとでか]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return hintTokens.some((token) => normalized.includes(token));
}
""",
    """const DIALOGUE_FORBIDDEN_CONTENT = /https?:\\/\\/|(?:パスワード|暗証番号|秘密情報|APIキー|アクセストークン|設定画面|外部サイト|リンクを開|貼り付けて|送信して|睡眠薬|服用|何錠|診断|病歴|住所|メールアドレス|電話番号|口座番号|クレジットカード)/i;

const QUESTION_GROUNDING_VALIDATORS: Record<string, (text: string) => boolean> = {
  planning_period: (text) => /(?:いつ|何日|期間|今週|来週|週末|開始|始め|終わり|まで)/.test(text),
  planning_start_date: (text) => /(?:いつ|何日|何曜|開始|始め)/.test(text),
  planning_duration: (text) => /(?:何日|日数|期間|どれくらい|何週間)/.test(text),
  tasks_or_goals: (text) => /(?:何を|学習内容|目標|教材|課題|勉強|進めたい)/.test(text),
  fixed_events: (text) => /(?:固定|動かせない|外せない|時間が決ま|登録済み).*(?:予定|授業|仕事|用事)|(?:予定|授業|仕事|用事).*(?:固定|動かせない|外せない|ありますか)/.test(text),
  sleep_cycle: (text) => /(?:睡眠|就寝|起床|寝る|起きる|勉強を始め).*(?:時間|時刻|何時|いつ|リズム)|(?:何時|いつ).*(?:寝|起き|勉強を始め)/.test(text),
  meal_bath_constraints: (text) => /(?:食事|朝食|昼食|夕食|風呂|入浴).*(?:時間|時刻|何時|どれくらい|入れにくい)/.test(text),
  life_constraints: (text) => /(?:生活|睡眠|食事|風呂|入浴).*(?:制約|時間|リズム|入れにくい)/.test(text),
  year_range: (text) => /(?:対象|過去問|試験).*(?:年度|何年).*(?:から|まで|範囲)|(?:年度|何年).*(?:から|まで|範囲)/.test(text),
  progress: (text) => /(?:進捗|現在|今).*(?:どこまで|終わ|済み|未着手)|(?:どこまで).*(?:進め|終わ)/.test(text),
  completion_direction: (text) => /(?:新しい|古い|どちら|どっち).*(?:年度|側|順)|(?:年度).*(?:新しい|古い|側)/.test(text),
  unit_rate: (text) => /(?:目安|かかる|かかります|必要|所要).*(?:時間|何時間|何分|どれくらい)|(?:何時間|何分|どれくらい).*(?:かかる|必要|目安)/.test(text),
  unit_duration_estimate: (text) => /(?:目安|かかる|かかります|必要|所要).*(?:時間|何時間|何分|どれくらい)|(?:何時間|何分|どれくらい).*(?:かかる|必要|目安)/.test(text),
  priority_policy: (text) => /(?:優先|順番|先).*(?:分野|科目|どれ|何|進め)|(?:分野|科目|どれ|何).*(?:優先|順番|先)/.test(text),
  next_field_after_math: (text) => /(?:次|その次).*(?:分野|科目)|(?:分野|科目).*(?:次|その次)/.test(text),
};

function isGroundedDialogueQuestion(planned: DialogueNextQuestion, text: string): boolean {
  const normalized = stripGenericAcknowledgementPrefix(text).replace(/\\s+/g, ' ').trim();
  if (!normalized || normalized.length > 240 || DIALOGUE_FORBIDDEN_CONTENT.test(normalized)) {
    return false;
  }
  const validator = QUESTION_GROUNDING_VALIDATORS[planned.slotKey];
  if (validator) return validator(normalized);
  const hintTokens = (planned.vocabularyHint ?? '')
    .split(/[\\s、。・／/やをのにへはがとでか]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return hintTokens.some((token) => normalized.includes(token));
}
""",
)

# ---------------------------------------------------------------------------
# 2. Readiness must require a matching year_field_chunk unit rate.
# ---------------------------------------------------------------------------
missing_path = 'src/features/weeklyPlanning/intake/weeklyPlanningMissingStatus.ts'
replace_once(
    missing_path,
    """export function hasConfirmedLifeConstraints(state: PlanningIntakeState): boolean {
  return hasConfirmedSleepCycle(state) && hasConfirmedMealBathConstraints(state);
}

export function deriveMissingForPlanningRange""",
    """export function hasConfirmedLifeConstraints(state: PlanningIntakeState): boolean {
  return hasConfirmedSleepCycle(state) && hasConfirmedMealBathConstraints(state);
}

export function hasConfirmedYearFieldUnitRate(state: PlanningIntakeState): boolean {
  return state.unitRates.some((rate) =>
    rate.unit === 'year_field_chunk'
    && typeof rate.minutesPerUnit === 'number'
    && Number.isFinite(rate.minutesPerUnit)
    && rate.minutesPerUnit > 0,
  );
}

function applyUnitRateMissingState(state: PlanningIntakeState): PlanningIntakeState {
  if (state.examPrepScope?.unitModel !== 'year_field_chunk') return state;
  const missing = hasConfirmedYearFieldUnitRate(state)
    ? removeMissing(state.missing, ['unit_duration_estimate'])
    : addMissing(state.missing, ['unit_duration_estimate']);
  return missing.length === state.missing.length
    && missing.every((item, index) => item === state.missing[index])
    ? state
    : { ...state, missing };
}

export function deriveMissingForPlanningRange""",
)
replace_once(
    missing_path,
    """    && state.unitRates.length > 0
""",
    """    && hasConfirmedYearFieldUnitRate(state)
""",
)
replace_once(
    missing_path,
    """export function finalizeState(state: PlanningIntakeState): PlanningIntakeState {
  const stateWithPriorityMissing = applyPriorityMissingState(state);
""",
    """export function finalizeState(state: PlanningIntakeState): PlanningIntakeState {
  const stateWithUnitRateMissing = applyUnitRateMissingState(state);
  const stateWithPriorityMissing = applyPriorityMissingState(stateWithUnitRateMissing);
""",
)

reducer_path = 'src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts'
replace_once(
    reducer_path,
    """      if (examPrepScope.unitModel === 'year_field_chunk' && nextState.unitRates.length === 0) {
        nextMissing = addMissing(nextMissing, ['unit_duration_estimate']);
      }
""",
    """      if (examPrepScope.unitModel === 'year_field_chunk') {
        const hasYearFieldUnitRate = nextState.unitRates.some((rate) =>
          rate.unit === 'year_field_chunk'
          && typeof rate.minutesPerUnit === 'number'
          && Number.isFinite(rate.minutesPerUnit)
          && rate.minutesPerUnit > 0,
        );
        nextMissing = hasYearFieldUnitRate
          ? removeMissing(nextMissing, ['unit_duration_estimate'])
          : addMissing(nextMissing, ['unit_duration_estimate']);
      }
""",
)

# ---------------------------------------------------------------------------
# 3. AI command grounding must validate payload values, not only command type.
# ---------------------------------------------------------------------------
validator_path = 'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts'
replace_once(
    validator_path,
    "import { normalizeIntakeText } from './weeklyPlanningTextParsing';\n",
    "import { normalizeIntakeText, parseSmallInteger } from './weeklyPlanningTextParsing';\n",
)
replace_once(
    validator_path,
    """function approximatelyContains(userText: string, expected: string): boolean {
  const user = normalizedEvidence(userText);
  const target = normalizedEvidence(expected);
  if (target.length < 4 || user.includes(target)) return false;
  for (const length of [target.length - 1, target.length, target.length + 1]) {
    if (length < 3) continue;
    for (let index = 0; index + length <= user.length; index += 1) {
      if (levenshteinDistance(user.slice(index, index + length), target) <= 1) return true;
    }
  }
  return false;
}

function validateCommandGrounding""",
    """function approximatelyContains(userText: string, expected: string): boolean {
  const user = normalizedEvidence(userText);
  const target = normalizedEvidence(expected);
  if (target.length < 4 || user.includes(target)) return false;
  for (const length of [target.length - 1, target.length, target.length + 1]) {
    if (length < 3) continue;
    for (let index = 0; index + length <= user.length; index += 1) {
      if (levenshteinDistance(user.slice(index, index + length), target) <= 1) return true;
    }
  }
  return false;
}

function explicitNumberValues(text: string): number[] {
  const normalized = normalizeIntakeText(text);
  const values = Array.from(normalized.matchAll(/\\d+(?:\\.\\d+)?/g))
    .map((match) => Number(match[0]))
    .filter(Number.isFinite);
  for (const match of normalized.matchAll(/[一二三四五六七八九十]+/g)) {
    const parsed = parseSmallInteger(match[0]);
    if (parsed !== undefined) values.push(parsed);
  }
  return Array.from(new Set(values));
}

function explicitMinuteValues(text: string): number[] {
  const normalized = normalizeIntakeText(text);
  const values: number[] = [];
  for (const match of normalized.matchAll(/(\\d+(?:\\.\\d+)?|[一二三四五六七八九十]+)\\s*時間(?:\\s*(\\d+|[一二三四五六七八九十]+)\\s*分)?/g)) {
    const hours = Number(match[1]) || parseSmallInteger(match[1]);
    const minutes = match[2] ? Number(match[2]) || parseSmallInteger(match[2]) || 0 : 0;
    if (hours !== undefined && Number.isFinite(hours)) values.push(hours * 60 + minutes);
  }
  for (const match of normalized.matchAll(/(\\d+(?:\\.\\d+)?|[一二三四五六七八九十]+)\\s*分(?!野)/g)) {
    const minutes = Number(match[1]) || parseSmallInteger(match[1]);
    if (minutes !== undefined && Number.isFinite(minutes)) values.push(minutes);
  }
  return Array.from(new Set(values));
}

function normalizedTextContainsValue(text: string, value: string | undefined): boolean {
  if (!value) return true;
  const normalized = normalizeIntakeText(text);
  if (normalized.includes(value)) return true;
  const [hourText, minuteText = '00'] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  return new RegExp(`${hour}\\s*時(?:\\s*${minute}\\s*分)?`).test(normalized)
    || new RegExp(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`).test(normalized);
}

function normalizedTextContainsDate(text: string, value: string | undefined): boolean {
  if (!value) return true;
  const normalized = normalizeIntakeText(text);
  if (normalized.includes(value)) return true;
  const match = value.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  return normalized.includes(`${Number(year)}年${Number(month)}月${Number(day)}日`)
    || normalized.includes(`${Number(month)}月${Number(day)}日`);
}

function lifeConstraintPayloadGrounded(params: {
  userText: string;
  date?: string;
  start?: string;
  end?: string;
  durationMinutes?: number;
  studyAvailableStart?: string;
}): boolean {
  return normalizedTextContainsDate(params.userText, params.date)
    && normalizedTextContainsValue(params.userText, params.start)
    && normalizedTextContainsValue(params.userText, params.end)
    && normalizedTextContainsValue(params.userText, params.studyAvailableStart)
    && (params.durationMinutes === undefined
      || explicitMinuteValues(params.userText).includes(params.durationMinutes));
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function relativePlanningDateGrounded(
  text: string,
  startDateTime: string | undefined,
  context: WeeklyPlanningIntakeContext | undefined,
): boolean {
  if (!startDateTime || !context) return true;
  const normalized = normalizeIntakeText(text);
  const currentDate = context.currentDateTime?.slice(0, 10) ?? context.selectedDate;
  const expected = /明後日/.test(normalized)
    ? addDays(currentDate, 2)
    : /明日/.test(normalized)
      ? addDays(currentDate, 1)
      : /今日/.test(normalized)
        ? currentDate
        : undefined;
  return expected === undefined || startDateTime.slice(0, 10) === expected;
}

function validateCommandGrounding""",
)

regex_replace_once(
    validator_path,
    r"function validateCommandGrounding\(.*?\n\}\n\nfunction requiresTypoConfirmation",
    """function validateCommandGrounding(
  candidate: InterpretedCommandCandidate,
  command: ParsedWeeklyPlanningCommand,
  summary: InterpreterStateSummary,
  context?: WeeklyPlanningIntakeContext,
): string | null {
  const userText = candidate.sourceUserText;
  if (!userText) return null;
  if (MODEL_INSTRUCTION_PATTERN.test(userText)) return 'prompt-injection-like-user-text';
  if (command.sourceSegment && !sourceTextIsGrounded(candidate, command)) return 'ungrounded-source-segment';
  const normalized = normalizeIntakeText(userText).trim();
  const normalizedUser = normalizedEvidence(normalized);
  switch (command.type) {
    case 'note_no_fixed_events': {
      const fixedEventsQuestion = summary.lastQuestions?.some((question) => question.slotKey === 'fixed_events');
      const explicit = /(?:固定|動かせない|外せない|予定).*(?:ない|なし|ありません)|(?:ない|なし|ありません).*(?:固定|予定)/.test(normalized);
      const shortAnswer = fixedEventsQuestion
        && /^(?:特に)?(?:ない|なし|ありません|ないです)[。！!]*$/.test(normalized);
      return explicit || shortAnswer ? null : 'ungrounded-no-fixed-events';
    }
    case 'set_unit_rate': {
      const minutes = command.unitRate.minutesPerUnit;
      const unitCompatible = command.unitRate.unit === 'year_field_chunk'
        || summary.examScopeSummary?.unitModel !== 'year_field_chunk';
      return command.unitRate.source === 'user'
        && typeof minutes === 'number'
        && explicitMinuteValues(normalized).includes(minutes)
        && unitCompatible
        ? null : 'ungrounded-unit-rate';
    }
    case 'set_priority_policy': {
      if (!/優先|順番|先に|から.*(?:進め|やり|解き|始め)/.test(normalized)) {
        return 'ungrounded-priority-policy';
      }
      if (command.policy.kind !== 'field_first') return null;
      const mentionedFields = summary.knownFields.filter((field) =>
        normalizedUser.includes(normalizedEvidence(field)));
      return mentionedFields.length <= 1
        || mentionedFields[0] === command.policy.order[0]
        ? null : 'ungrounded-priority-policy';
    }
    case 'use_constraint_source':
      return /時間割|予定表|登録済み|保存済み|いつもの授業|カレンダー/.test(normalized)
        ? null : 'ungrounded-constraint-source';
    case 'request_clarification':
      return /意味|どういう|何を答え|とは|って何|わからない/.test(normalized)
        ? null : 'ungrounded-clarification-request';
    case 'set_planning_range':
      return /今日|明日|明後日|今週|来週|週末|夏休み|[月火水木金土日]曜|\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日|から|まで|週間|日間/.test(normalized)
        && relativePlanningDateGrounded(normalized, command.range.startDateTime, context)
        ? null : 'ungrounded-planning-range';
    case 'set_pending_planning_range':
      return /今日|明日|明後日|今週|来週|週末|夏休み|[月火水木金土日]曜|\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日|から|まで|週間|日間/.test(normalized)
        && relativePlanningDateGrounded(
          normalized,
          command.pending.planningStartDateTime ?? command.pending.planningStartDate,
          context,
        )
        ? null : 'ungrounded-planning-range';
    case 'begin_weekly_planning':
      return /予定|計画|スケジュール/.test(normalized) && /立て|作|組|決め|したい|お願い/.test(normalized)
        ? null : 'ungrounded-planning-intent';
    case 'set_exam_scope': {
      const knownFields = new Set(summary.knownFields.map(normalizedEvidence));
      const fieldsGrounded = command.scope.fields.every((field) => {
        const normalizedField = normalizedEvidence(field);
        return knownFields.has(normalizedField)
          || normalizedUser.includes(normalizedField)
          || approximatelyContains(normalized, field);
      });
      const range = command.scope.yearRange;
      const yearRangeGrounded = !range
        || (normalizedUser.includes(String(range.startYear))
          && normalizedUser.includes(String(range.endYear)));
      const existingScope = summary.examScopeSummary;
      const examTypeGrounded = !command.scope.examType
        || normalizedUser.includes(normalizedEvidence(command.scope.examType))
        || command.scope.examType === existingScope?.examType;
      const unitModelGrounded = command.scope.unitModel !== 'year_field_chunk'
        || existingScope?.unitModel === 'year_field_chunk'
        || /院試|過去問|年度|年分/.test(normalized);
      const explicitNumbers = explicitNumberValues(normalized);
      const totalFieldsGrounded = command.scope.totalFields === undefined
        || command.scope.totalFields === command.scope.fields.length
        || (explicitNumbers.includes(command.scope.totalFields)
          && /(?:分野|科目)/.test(normalized));
      const totalYearsGrounded = command.scope.totalYears === undefined
        || (range && Math.abs(range.startYear - range.endYear) + 1 === command.scope.totalYears)
        || (explicitNumbers.includes(command.scope.totalYears) && /年分/.test(normalized));
      return fieldsGrounded
        && yearRangeGrounded
        && examTypeGrounded
        && unitModelGrounded
        && totalFieldsGrounded
        && totalYearsGrounded
        ? null : 'ungrounded-exam-scope';
    }
    case 'add_fixed_event':
      return /\\d{1,2}\\s*時|\\d{1,2}:\\d{2}|睡眠|寝|食事|夕食|風呂|入浴|移動|バイト|授業|予定/.test(normalized)
        && lifeConstraintPayloadGrounded({ userText: normalized, ...command.event })
        ? null : 'ungrounded-life-constraint';
    case 'add_unavailable':
      return /\\d{1,2}\\s*時|\\d{1,2}:\\d{2}|睡眠|寝|食事|夕食|風呂|入浴|移動|バイト|授業|予定/.test(normalized)
        && lifeConstraintPayloadGrounded({ userText: normalized, ...command.range })
        ? null : 'ungrounded-life-constraint';
    case 'update_life_constraint':
      return /\\d{1,2}\\s*時|\\d{1,2}:\\d{2}|睡眠|寝|食事|夕食|風呂|入浴|移動|バイト|授業|予定/.test(normalized)
        && lifeConstraintPayloadGrounded({ userText: normalized, ...command.constraint })
        ? null : 'ungrounded-life-constraint';
    case 'mark_completed_units':
      return /年度|年分|終|済|未着手|進捗|どこまで/.test(normalized)
        && command.completedYears.every((year) => normalizedUser.includes(String(year)))
        ? null : 'ungrounded-progress';
    case 'mark_completion_target': {
      const target = command.target;
      const valuesGrounded = target.kind === 'latest_n_years'
        ? explicitNumberValues(normalized).includes(target.count)
        : target.kind === 'year_range'
          ? normalizedUser.includes(String(target.startYear))
            && normalizedUser.includes(String(target.endYear))
          : true;
      return /年度|年分|終|済|未着手|進捗|どこまで/.test(normalized)
        && valuesGrounded
        ? null : 'ungrounded-progress';
    }
    case 'note_progress_boundary':
      return /年度|年分|終|済|未着手|進捗|どこまで/.test(normalized)
        && normalizedUser.includes(String(command.boundaryYear))
        ? null : 'ungrounded-progress';
    case 'set_study_goal': {
      const titleGrounded = normalizedUser.includes(normalizedEvidence(command.goal.title))
        || approximatelyContains(normalized, command.goal.title);
      const subjectGrounded = !command.goal.subject
        || normalizedUser.includes(normalizedEvidence(command.goal.subject))
        || approximatelyContains(normalized, command.goal.subject);
      const amountGrounded = command.goal.amount === undefined
        || (command.goal.unit === 'minutes'
          ? explicitMinuteValues(normalized).includes(command.goal.amount)
          : explicitNumberValues(normalized).includes(command.goal.amount));
      return /勉強|学習|課題|ワーク|過去問|進め|やり|解き|復習|暗記|おさらい|取り組/.test(normalized)
        && titleGrounded
        && subjectGrounded
        && amountGrounded
        ? null : 'ungrounded-study-goal';
    }
    case 'note_uncertainty':
      return /わから|不明|不確か|自信|たぶん|かも|苦手|時間がかか/.test(normalized)
        ? null : 'ungrounded-uncertainty';
    default:
      return null;
  }
}

function requiresTypoConfirmation""",
)
replace_once(
    validator_path,
    """    const groundingError = validateCommandGrounding(candidate, command, summary);
""",
    """    const groundingError = validateCommandGrounding(candidate, command, summary, context);
""",
)

# ---------------------------------------------------------------------------
# 4. Immutable trace writes must be atomic and idempotent.
# ---------------------------------------------------------------------------
firestore_path = 'workers/ai-proxy/src/weeklyPlanningTraceFirestore.ts'
replace_once(
    firestore_path,
    """  async setImmutableDocument(
    collection: string,
    id: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.getDocument(collection, id);
    if (existing) {
      const normalizedExisting = { ...existing };
      delete normalizedExisting.id;
      if (stableJson(normalizedExisting) !== stableJson(value)) {
        throw new Error(`immutable trace document conflict: ${collection}/${id}`);
      }
      return;
    }
    await this.setDocument(collection, id, value);
  }
""",
    """  async setImmutableDocument(
    collection: string,
    id: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const params = new URLSearchParams({ documentId: id });
    const response = await this.request(
      `${this.documentsBase()}/${encodeURIComponent(collection)}?${params.toString()}`,
      {
        method: 'POST',
        body: JSON.stringify({ fields: encodeFirestoreFields(value) }),
      },
    );
    if (response.ok) return;
    if (response.status !== 409) {
      throw new Error(`Firestore immutable write failed: ${response.status}`);
    }

    const existing = await this.getDocument(collection, id);
    if (!existing) {
      throw new Error(`immutable trace document conflict: ${collection}/${id}`);
    }
    const normalizedExisting = { ...existing };
    const normalizedValue = { ...value };
    delete normalizedExisting.id;
    delete normalizedValue.id;
    if (stableJson(normalizedExisting) !== stableJson(normalizedValue)) {
      throw new Error(`immutable trace document conflict: ${collection}/${id}`);
    }
  }
""",
)

# ---------------------------------------------------------------------------
# 5. Regression tests for all independently found defects.
# ---------------------------------------------------------------------------
renderer_test = 'src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.test.ts'
anchor = """  it('includes command-derived goal titles in deterministic accepted facts', async () => {
"""
addition = """  it('does not repeat old exam facts when a short old source appears inside the current priority answer', () => {
    const previousState: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      examPrepScope: {
        examType: '院試',
        fields: ['OS'],
        totalFields: 1,
        unitModel: 'year_field_chunk',
        rawText: ['OS'],
      },
      priorityPolicy: { kind: 'unknown' },
      sourceTurns: ['OS'],
    };
    const state: PlanningIntakeState = {
      ...previousState,
      priorityPolicy: { kind: 'field_first', order: ['OS'] },
      priorityPolicySource: 'user',
      sourceTurns: [...previousState.sourceTurns, 'OSを優先します'],
    };

    const input = createDialogueRenderInput({
      state,
      previousState,
      decision: askScopeDecision(),
    });

    expect(input.acceptedFacts.fields).toBeUndefined();
    expect(input.acceptedFacts.totalFields).toBeUndefined();
    expect(input.acceptedFacts.priorityOrder).toEqual(['OS']);
  });

  it.each([
    ['sleep medication drift', 'sleep_cycle', '睡眠薬は何錠飲みますか？'],
    ['lateness drift', 'unit_rate', '何分遅刻しましたか？'],
    ['graduation-year drift', 'year_range', '卒業年度は何年ですか？'],
  ])('rejects renderer semantic drift: %s', (_label, slotKey, text) => {
    const input: DialogueRenderInput = {
      acceptedFacts: {},
      assumptions: [],
      nextQuestions: [{
        slotKey,
        intent: 'ask_missing_info',
        vocabularyHint: slotKey === 'sleep_cycle'
          ? '睡眠時間や、何時から勉強を始められるか'
          : slotKey === 'unit_rate'
            ? '1年分・1分野あたりの目安時間'
            : '対象の年度範囲',
      }],
      styleConstraints: { tone: 'mentor', maxQuestions: 1 },
    };

    expect(sanitizeDialogueRenderOutput({
      questions: [{ slotKey, text }],
    }, input)).toBeNull();
  });

"""
replace_once(renderer_test, anchor, addition + anchor)
replace_once(
    renderer_test,
    """  createDialogueRenderInput,
  renderWeeklyPlanningDialogueMessage,
""",
    """  createDialogueRenderInput,
  renderWeeklyPlanningDialogueMessage,
  sanitizeDialogueRenderOutput,
  type DialogueRenderInput,
""",
)

adversarial_test = 'src/features/weeklyPlanning/__tests__/weeklyPlanningAdversarialInput.test.ts'
anchor = """  it('rejects renderer text that preserves the slot key but changes the meaning', () => {
"""
addition = """  it.each([
    [
      'study goal title',
      '英語を勉強したいです',
      {
        type: 'set_study_goal',
        goal: { title: '数学' },
        sourceText: '英語を勉強したいです',
        confidence: 'high',
      },
      'ungrounded-study-goal',
    ],
    [
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
      'invented exam classification',
      'OSを勉強したいです',
      {
        type: 'set_exam_scope',
        scope: {
          examType: '院試',
          fields: ['OS'],
          unitModel: 'year_field_chunk',
          rawText: ['OSを勉強したいです'],
        },
        sourceText: 'OSを勉強したいです',
        confidence: 'high',
      },
      'ungrounded-exam-scope',
    ],
    [
      'life-constraint time',
      '23時から7時まで寝ます',
      {
        type: 'update_life_constraint',
        kind: 'sleep',
        constraint: {
          start: '22:00',
          end: '07:00',
          hardness: 'hard',
        },
        sourceText: '23時から7時まで寝ます',
        confidence: 'high',
      },
      'ungrounded-life-constraint',
    ],
    [
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
  ])('rejects an AI command with an ungrounded payload value: %s', (
    _label,
    userText,
    command,
    reason,
  ) => {
    const result = validateInterpretedCandidates([{
      command: command as never,
      origin: 'ai_interpreter',
      needsConfirmation: false,
      sourceUserText: userText,
    }], {
      knownFields: ['OS', 'ネットワーク'],
      confirmedSlots: [],
      examScopeSummary: {
        examType: '院試',
        fields: ['OS', 'ネットワーク'],
        unitModel: 'year_field_chunk',
        rawText: ['院試の過去問はOSとネットワーク'],
      },
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason }),
    ]);
  });

"""
replace_once(adversarial_test, anchor, addition + anchor)

readiness_test = 'src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts'
text = Path(readiness_test).read_text()
if "createWeeklyDraftRequestFromIntakeState" not in text:
    text = text.replace(
        "import { describe, expect, it } from 'vitest';\n",
        "import { describe, expect, it } from 'vitest';\nimport { createWeeklyDraftRequestFromIntakeState } from '../intake/weeklyPlanningDraftRequestAdapter';\n",
        1,
    )
anchor = """describe('weekly planning legacy fallback', () => {
"""
addition = """describe('weekly planning readiness invariants', () => {
  it('does not become draft-ready with an unrelated non-exam unit rate', () => {
    const state = finalizeState({
      ...createInitialPlanningIntakeState(),
      intent: 'exam_prep_planning',
      examPrepScope: {
        examType: '院試',
        fields: ['OS'],
        totalFields: 1,
        yearRange: { startYear: 2025, endYear: 2025, sourceText: '2025年度' },
        unitModel: 'year_field_chunk',
        rawText: ['院試の過去問はOS'],
      },
      unitRates: [{
        unit: 'hours',
        minutesPerUnit: 120,
        source: 'user',
        rawText: '2時間',
      }],
      priorityPolicy: { kind: 'field_first', order: ['OS'] },
      fixedEventsDeclaredNone: true,
      constraints: [
        { kind: 'sleep', start: '23:00', end: '07:00', hardness: 'hard' },
        { kind: 'meal', durationMinutes: 60, hardness: 'soft' },
        { kind: 'bath', durationMinutes: 30, hardness: 'soft' },
      ],
      missing: [],
    });

    expect(state.status).toBe('needs_unit_rate');
    expect(state.missing).toContain('unit_duration_estimate');
    expect(state.shouldCreateDraft).toBe(false);
    expect(createWeeklyDraftRequestFromIntakeState(state)).toBeNull();
  });
});

"""
if anchor not in text:
    raise RuntimeError('legacy fallback describe anchor not found')
Path(readiness_test).write_text(text.replace(anchor, addition + anchor, 1))

firestore_test = 'workers/ai-proxy/src/weeklyPlanningTraceFirestore.integration.test.ts'
text = Path(firestore_test).read_text()
anchor = """  it('uses the Firestore document path ID instead of redacted structural fields for get and query', async () => {
"""
addition = """  it('creates immutable documents atomically and accepts an identical retry', async () => {
    const value = { id: ENTRY_ID, sessionId: SESSION_ID, sequence: 0, content: 'first' };
    let createAttempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/weekly_planning_trace_entries?documentId=')) {
        expect(init?.method).toBe('POST');
        createAttempts += 1;
        return createAttempts === 1
          ? new Response('{}', { status: 200 })
          : new Response('{}', { status: 409 });
      }
      if (url.endsWith(`/weekly_planning_trace_entries/${encodeURIComponent(ENTRY_ID)}`)) {
        return new Response(JSON.stringify(firestoreDocument(ENTRY_ID, value)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new WeeklyPlanningTraceFirestoreClient(
      env(),
      fetcher as typeof fetch,
      fakeCrypto(),
    );

    await expect(client.setImmutableDocument(
      'weekly_planning_trace_entries',
      ENTRY_ID,
      value,
    )).resolves.toBeUndefined();
    await expect(client.setImmutableDocument(
      'weekly_planning_trace_entries',
      ENTRY_ID,
      value,
    )).resolves.toBeUndefined();
    expect(createAttempts).toBe(2);
  });

  it('rejects an immutable retry whose payload differs from the stored document', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/weekly_planning_trace_entries?documentId=')) {
        return new Response('{}', { status: 409 });
      }
      if (url.endsWith(`/weekly_planning_trace_entries/${encodeURIComponent(ENTRY_ID)}`)) {
        return new Response(JSON.stringify(firestoreDocument(ENTRY_ID, {
          id: ENTRY_ID,
          sessionId: SESSION_ID,
          sequence: 0,
          content: 'stored',
        })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new WeeklyPlanningTraceFirestoreClient(
      env(),
      fetcher as typeof fetch,
      fakeCrypto(),
    );

    await expect(client.setImmutableDocument(
      'weekly_planning_trace_entries',
      ENTRY_ID,
      { id: ENTRY_ID, sessionId: SESSION_ID, sequence: 0, content: 'different' },
    )).rejects.toThrow(/immutable trace document conflict/);
  });

"""
if anchor not in text:
    raise RuntimeError('firestore integration anchor not found')
Path(firestore_test).write_text(text.replace(anchor, addition + anchor, 1))
