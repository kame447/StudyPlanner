import {
  isDateWithinWindow,
  isIsoCalendarDate,
  isOrderedPlanningDateTimeRange,
  isValidPlanningDateTime,
  isValidDateWindow,
  isValidPlanningDurationDays,
} from './weeklyPlanningDateValidation';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import type {
  CandidateValidationResult,
  InterpretedCommandCandidate,
  InterpreterStateSummary,
} from './weeklyPlanningInterpreterTypes';
import { studyGoalIdentity } from './weeklyPlanningTaskIdentity';
import { isValidWeeklyPlanningCommand } from './weeklyPlanningCommandRuntimeValidation';
import { normalizeExamScopeEnrichment } from './weeklyPlanningExamScopeEnrichment';
import { isPlanningRangeConsistentWithAbsoluteDateSource } from './weeklyPlanningAbsoluteDate';
import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import { normalizeIntakeText, parseSmallInteger } from './weeklyPlanningTextParsing';

const CONFIDENCE_RANK = {
  low: 0,
  medium: 1,
  high: 2,
} as const;

export const KNOWN_COMMAND_TYPES = new Set([
  'add_unavailable',
  'add_fixed_event',
  'update_life_constraint',
  'use_constraint_source',
  'request_clarification',
  'set_priority_policy',
  'mark_completed_units',
  'mark_completion_target',
  'note_progress_boundary',
  'note_no_fixed_events',
  'note_uncertainty',
  'set_unit_rate',
  'set_exam_scope',
  'set_planning_range',
  'set_pending_planning_range',
  'begin_weekly_planning',
  'set_study_goal',
]);

const STUDY_SCOPE_UNITS = new Set([
  'minutes',
  'hours',
  'pages',
  'problems',
  'words',
  'lessons',
  'chapters',
  'year_field_chunk',
  'topic',
  'unknown',
]);

const PRIORITY_POLICY_KINDS = new Set([
  'field_first',
  'deadline_first',
  'weakness_first',
  'score_weight_first',
  'balanced',
  'unknown',
]);

const LIFE_CONSTRAINT_KINDS = new Set([
  'sleep',
  'meal',
  'bath',
  'commute',
  'club',
  'cram_school',
  'buffer',
]);

const PLANNING_TEMPORAL_SCOPE_KINDS = new Set(['next_week', 'named_future_period']);

const HARDNESS_VALUES = new Set(['hard', 'soft']);
const MERGE_MODES = new Set(['replace', 'append']);
const CONSTRAINT_SOURCE_KINDS = new Set(['timetable', 'existing_plans', 'calendar']);
const CLARIFICATION_TARGETS = new Set(['referenced_question', 'referenced_term', 'unresolved_slot']);
const COMPLETION_TARGET_KINDS = new Set([
  'all',
  'latest_n_years',
  'up_to_reachable',
  'year_range',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTime(value: unknown): boolean {
  return typeof value === 'string'
    && /^(?:[01]?\d|2[0-3]):[0-5]\d$|^24:00$/.test(value);
}

function isDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isReasonableYear(year: unknown): boolean {
  if (typeof year !== 'number' || !Number.isInteger(year)) {
    return false;
  }

  return year >= 2000 && year <= new Date().getFullYear() + 1;
}

function isReasonableMinutes(minutes: unknown): boolean {
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60;
}

function commandType(command: unknown): string | undefined {
  return isRecord(command) && typeof command.type === 'string' ? command.type : undefined;
}

function validateEnumVocabulary(command: ParsedWeeklyPlanningCommand): string | null {
  switch (command.type) {
    case 'set_pending_planning_range':
      return !PLANNING_TEMPORAL_SCOPE_KINDS.has(command.pending.scope.kind)
        ? 'invalid-planning-temporal-scope-kind' : null;
    case 'set_study_goal':
      return command.goal.unit !== undefined && !STUDY_SCOPE_UNITS.has(command.goal.unit)
        ? 'invalid-unit'
        : null;
    case 'set_exam_scope':
      return command.scope.unitModel && !STUDY_SCOPE_UNITS.has(command.scope.unitModel)
        ? 'invalid-unit-model'
        : null;
    case 'set_unit_rate':
      return !STUDY_SCOPE_UNITS.has(command.unitRate.unit) ? 'invalid-unit' : null;
    case 'set_priority_policy':
      return !PRIORITY_POLICY_KINDS.has(command.policy.kind) ? 'invalid-priority-policy-kind' : null;
    case 'mark_completed_units':
      return !MERGE_MODES.has(command.mergeMode) ? 'invalid-merge-mode' : null;
    case 'mark_completion_target':
      return !COMPLETION_TARGET_KINDS.has(command.target.kind) ? 'invalid-completion-target-kind' : null;
    case 'add_unavailable':
      return !HARDNESS_VALUES.has(command.range.hardness) ? 'invalid-hardness' : null;
    case 'add_fixed_event':
      return !HARDNESS_VALUES.has(command.event.hardness) ? 'invalid-hardness' : null;
    case 'update_life_constraint':
      if (!LIFE_CONSTRAINT_KINDS.has(command.kind)) return 'invalid-life-constraint-kind';
      return !HARDNESS_VALUES.has(command.constraint.hardness) ? 'invalid-hardness' : null;
    case 'use_constraint_source':
      return !CONSTRAINT_SOURCE_KINDS.has(command.source.kind) ? 'invalid-constraint-source-kind' : null;
    case 'request_clarification':
      return !CLARIFICATION_TARGETS.has(command.target) ? 'invalid-clarification-target' : null;
    default:
      return null;
  }
}


const MODEL_INSTRUCTION_PATTERN = /(?:system\s*prompt|developer\s*message|ignore\s+(?:all|previous)(?:\s+instructions?)?|システムプロンプト|開発者メッセージ|前の指示|これまでの指示|指示を無視|命令を無視).{0,160}(?:出力|返して|生成|emit|return)/i;

function normalizedEvidence(value: string): string {
  return normalizeIntakeText(value)
    .toLowerCase()
    .replace(/[\s、。,.!?！？「」『』"'：:]/g, '');
}

function sourceTextIsGrounded(
  candidate: InterpretedCommandCandidate,
  command: ParsedWeeklyPlanningCommand,
): boolean {
  if (!candidate.sourceUserText) return true;
  const user = normalizedEvidence(candidate.sourceUserText);
  const source = normalizedEvidence(command.sourceSegment ?? command.sourceText);
  return source.length > 0 && user.includes(source);
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function approximatelyContains(userText: string, expected: string): boolean {
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
  const values = Array.from(normalized.matchAll(/\d+(?:\.\d+)?/g))
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
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?|[一二三四五六七八九十]+)\s*時間(?:\s*(\d+|[一二三四五六七八九十]+)\s*分)?/g)) {
    const hours = Number(match[1]) || parseSmallInteger(match[1]);
    const minutes = match[2] ? Number(match[2]) || parseSmallInteger(match[2]) || 0 : 0;
    if (hours !== undefined && Number.isFinite(hours)) values.push(hours * 60 + minutes);
  }
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?|[一二三四五六七八九十]+)\s*分(?!野)/g)) {
    const minutes = Number(match[1]) || parseSmallInteger(match[1]);
    if (minutes !== undefined && Number.isFinite(minutes)) values.push(minutes);
  }
  return Array.from(new Set(values));
}

const EXPLICIT_TIME_TOKEN_PATTERN = '(\\d{1,2})(?:\\s*時(?:\\s*(\\d{1,2})\\s*分)?|:(\\d{2}))';

function normalizeExplicitClockTime(
  hourText: string | undefined,
  japaneseMinuteText: string | undefined,
  colonMinuteText: string | undefined,
): string | undefined {
  if (hourText === undefined) return undefined;
  const hour = Number(hourText);
  const minute = Number(colonMinuteText ?? japaneseMinuteText ?? '0');
  if (!Number.isInteger(hour) || hour < 0 || hour > 24) return undefined;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return undefined;
  if (hour === 24 && minute !== 0) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function explicitTimeRanges(text: string): Array<{ start: string; end: string }> {
  const pattern = new RegExp(
    `${EXPLICIT_TIME_TOKEN_PATTERN}\\s*(?:から|〜|～|~|－|-|–|—)\\s*${EXPLICIT_TIME_TOKEN_PATTERN}\\s*(?:まで)?`,
    'g',
  );
  const ranges: Array<{ start: string; end: string }> = [];
  for (const match of normalizeIntakeText(text).matchAll(pattern)) {
    const start = normalizeExplicitClockTime(match[1], match[2], match[3]);
    const end = normalizeExplicitClockTime(match[4], match[5], match[6]);
    if (start && end) ranges.push({ start, end });
  }
  return ranges;
}

function normalizedTextContainsValue(text: string, value: string | undefined): boolean {
  if (!value) return true;
  const normalized = normalizeIntakeText(text);
  if (normalized.includes(value)) return true;
  const [hourText, minuteText = '00'] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  if (minute === 0) {
    return new RegExp(`${hour}\\s*時(?!\\s*\\d+\\s*分)`).test(normalized)
      || new RegExp(`${String(hour).padStart(2, '0')}:00`).test(normalized);
  }
  return new RegExp(`${hour}\\s*時\\s*${minute}\\s*分`).test(normalized)
    || new RegExp(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`).test(normalized);
}

function normalizedTextContainsDate(text: string, value: string | undefined): boolean {
  if (!value) return true;
  const normalized = normalizeIntakeText(text);
  if (normalized.includes(value)) return true;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  return normalized.includes(`${Number(year)}年${Number(month)}月${Number(day)}日`)
    || normalized.includes(`${Number(month)}月${Number(day)}日`);
}

function splitLifeConstraintSegments(text: string): string[] {
  return normalizeIntakeText(text)
    .split(/(?:[、，,。．.!！?？;；\n]+|そして|その後|また)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function lifeConstraintEvidenceSegments(
  userText: string,
  kind: Extract<ParsedWeeklyPlanningCommand, { type: 'update_life_constraint' }>['kind'] | undefined,
): string[] {
  if (!kind) return [userText];
  const matched = splitLifeConstraintSegments(userText)
    .filter((segment) => LIFE_CONSTRAINT_KIND_PATTERNS[kind].test(segment));
  return matched.length > 0 ? matched : [userText];
}

function lifeConstraintPayloadGrounded(params: {
  userText: string;
  kind?: Extract<ParsedWeeklyPlanningCommand, { type: 'update_life_constraint' }>['kind'];
  date?: string;
  start?: string;
  end?: string;
  durationMinutes?: number;
  studyAvailableStart?: string;
}): boolean {
  return lifeConstraintEvidenceSegments(params.userText, params.kind).some((segment) => {
    const ranges = params.start && params.end ? explicitTimeRanges(segment) : [];
    const orderedRangeGrounded = ranges.length === 0
      || ranges.some((range) => range.start === params.start && range.end === params.end);
    return orderedRangeGrounded
      && normalizedTextContainsDate(segment, params.date)
      && normalizedTextContainsValue(segment, params.start)
      && normalizedTextContainsValue(segment, params.end)
      && normalizedTextContainsValue(segment, params.studyAvailableStart)
      && (params.durationMinutes === undefined
        || explicitMinuteValues(segment).includes(params.durationMinutes));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function validateCommandGrounding(
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
    case 'set_priority_policy': {
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
    case 'use_constraint_source':
      return /時間割|予定表|登録済み|保存済み|いつもの授業|カレンダー/.test(normalized)
        ? null : 'ungrounded-constraint-source';
    case 'request_clarification':
      return /意味|どういう|何を答え|とは|って何|わからない/.test(normalized)
        ? null : 'ungrounded-clarification-request';
    case 'set_planning_range':
      return /今日|明日|明後日|今週|来週|週末|夏休み|[月火水木金土日]曜|\d{1,2}\s*月\s*\d{1,2}\s*日|から|まで|週間|日間/.test(normalized)
        && relativePlanningDateGrounded(normalized, command.range.startDateTime, context)
        ? null : 'ungrounded-planning-range';
    case 'set_pending_planning_range':
      return /今日|明日|明後日|今週|来週|週末|夏休み|[月火水木金土日]曜|\d{1,2}\s*月\s*\d{1,2}\s*日|から|まで|週間|日間/.test(normalized)
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
        || /院試|過去問|年度|年分|20\d{2}\s*[〜~-]\s*20\d{2}/.test(normalized);
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
      return /\d{1,2}\s*時|\d{1,2}:\d{2}|睡眠|寝|食事|夕食|風呂|入浴|移動|バイト|授業|予定/.test(normalized)
        && lifeConstraintPayloadGrounded({ userText: normalized, ...command.event })
        ? null : 'ungrounded-life-constraint';
    case 'add_unavailable':
      return /\d{1,2}\s*時|\d{1,2}:\d{2}|睡眠|寝|食事|夕食|風呂|入浴|移動|バイト|授業|予定/.test(normalized)
        && lifeConstraintPayloadGrounded({ userText: normalized, ...command.range })
        ? null : 'ungrounded-life-constraint';
    case 'update_life_constraint':
      return lifeConstraintKindGrounded(command.kind, normalized, summary)
        && lifeConstraintPayloadGrounded({
          userText: normalized,
          kind: command.kind,
          ...command.constraint,
        })
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
      const goalEvidenceStem = (value: string) => normalizedEvidence(value)
        .replace(/(?:したいです|したい|します|する|した)$/, '');
      const normalizedGoalTitle = goalEvidenceStem(command.goal.title);
      const normalizedGoalUser = goalEvidenceStem(normalized);
      const titleGrounded = normalizedGoalUser.includes(normalizedGoalTitle)
        || normalizedUser.includes(normalizedEvidence(command.goal.title))
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

function requiresTypoConfirmation(
  candidate: InterpretedCommandCandidate,
  command: ParsedWeeklyPlanningCommand,
): boolean {
  return Boolean(candidate.sourceUserText
    && command.type === 'set_exam_scope'
    && command.scope.fields.some((field) => approximatelyContains(candidate.sourceUserText!, field)));
}

function constraintSourceAvailable(
  source: Extract<ParsedWeeklyPlanningCommand, { type: 'use_constraint_source' }>['source'],
  summary: InterpreterStateSummary,
): boolean {
  const availability = summary.availableConstraintSources;

  if (!availability) {
    return false;
  }

  switch (source.kind) {
    case 'timetable':
      return availability.timetable;
    case 'existing_plans':
      return availability.existingPlans;
    case 'calendar':
      return availability.calendar;
    default:
      return false;
  }
}

function validateValueRange(command: ParsedWeeklyPlanningCommand): string | null {
  switch (command.type) {
    case 'set_planning_range':
      return (command.range.startDateTime === undefined
        && command.range.endDateTime === undefined)
        || isOrderedPlanningDateTimeRange(command.range)
        ? null
        : 'invalid-planning-range';
    case 'set_pending_planning_range': {
      const {
        scope,
        planningStartDate,
        planningStartDateTime,
        durationDays,
        planningEndDateTime,
      } = command.pending;
      if (!isValidDateWindow(scope)) return 'invalid-pending-planning-range';
      if (planningStartDate !== undefined && !isIsoCalendarDate(planningStartDate)) {
        return 'invalid-pending-planning-range';
      }
      if (planningStartDateTime !== undefined
        && (!isValidPlanningDateTime(planningStartDateTime)
          || planningStartDate === undefined
          || planningStartDateTime.slice(0, 10) !== planningStartDate)) {
        return 'invalid-pending-planning-range';
      }
      if (planningEndDateTime !== undefined
        && (!isValidPlanningDateTime(planningEndDateTime)
          || scope.windowEndDate === undefined
          || planningEndDateTime.slice(0, 10) !== scope.windowEndDate)) {
        return 'invalid-pending-planning-range';
      }
      if (durationDays !== undefined && !isValidPlanningDurationDays(durationDays)) {
        return 'invalid-duration-days';
      }
      if (durationDays !== undefined && planningEndDateTime !== undefined) {
        return 'invalid-pending-planning-range';
      }
      const resolvedStartDate = planningStartDateTime?.slice(0, 10) ?? planningStartDate;
      if (resolvedStartDate !== undefined && !isDateWithinWindow(resolvedStartDate, scope)) {
        return 'invalid-pending-planning-range';
      }
      if (resolvedStartDate !== undefined
        && (durationDays !== undefined || planningEndDateTime !== undefined)) {
        return 'resolved-pending-planning-range';
      }
      return null;
    }
    case 'set_study_goal':
      return command.goal.amount === undefined
        || (typeof command.goal.amount === 'number'
          && Number.isFinite(command.goal.amount)
          && command.goal.amount > 0)
        ? null
        : 'invalid-goal-amount';
    case 'set_exam_scope': {
      const yearRange = command.scope.yearRange;
      if (yearRange && (!isReasonableYear(yearRange.startYear) || !isReasonableYear(yearRange.endYear))) {
        return 'invalid-year-range';
      }
      return null;
    }
    case 'mark_completed_units':
      return command.completedYears.every(isReasonableYear) ? null : 'invalid-completed-year';
    case 'mark_completion_target':
      if (command.target.kind === 'latest_n_years') {
        return Number.isInteger(command.target.count) && command.target.count > 0 ? null : 'invalid-completion-target-count';
      }
      if (command.target.kind === 'year_range') {
        return isReasonableYear(command.target.startYear) && isReasonableYear(command.target.endYear)
          ? null
          : 'invalid-completion-target-year-range';
      }
      return null;
    case 'note_progress_boundary':
      return isReasonableYear(command.boundaryYear) ? null : 'invalid-progress-year';
    case 'set_unit_rate':
      return isReasonableMinutes(command.unitRate.minutesPerUnit) ? null : 'invalid-unit-rate-minutes';
    case 'add_unavailable':
      if (command.range.date && !isDate(command.range.date)) return 'invalid-date';
      if (command.range.start && !isTime(command.range.start)) return 'invalid-time';
      if (command.range.end && !isTime(command.range.end)) return 'invalid-time';
      return null;
    case 'add_fixed_event':
      if (command.event.date && !isDate(command.event.date)) return 'invalid-date';
      if (command.event.start && !isTime(command.event.start)) return 'invalid-time';
      if (command.event.end && !isTime(command.event.end)) return 'invalid-time';
      if (command.event.durationMinutes !== undefined && !isReasonableMinutes(command.event.durationMinutes)) {
        return 'invalid-duration-minutes';
      }
      return null;
    case 'update_life_constraint':
      if (command.constraint.date && !isDate(command.constraint.date)) return 'invalid-date';
      if (command.constraint.start && !isTime(command.constraint.start)) return 'invalid-time';
      if (command.constraint.end && !isTime(command.constraint.end)) return 'invalid-time';
      if (command.constraint.durationMinutes !== undefined && !isReasonableMinutes(command.constraint.durationMinutes)) {
        return 'invalid-duration-minutes';
      }
      return null;
    default:
      return null;
  }
}

function commandSlotKeys(command: ParsedWeeklyPlanningCommand): string[] {
  switch (command.type) {
    case 'set_exam_scope': {
      const slots: string[] = [];
      if (command.scope.fields.length > 0) slots.push('exam_scope');
      if (command.scope.yearRange) slots.push('year_range');
      return slots;
    }
    case 'set_planning_range':
    case 'set_pending_planning_range':
      return ['planning_range'];
    case 'set_priority_policy':
      return ['priority_policy'];
    case 'mark_completed_units':
    case 'mark_completion_target':
    case 'note_progress_boundary':
      return ['progress'];
    case 'set_unit_rate':
      return ['unit_duration_estimate'];
    case 'add_fixed_event':
    case 'note_no_fixed_events':
    case 'use_constraint_source':
      return ['fixed_events'];
    case 'add_unavailable':
      return ['fixed_events'];
    case 'update_life_constraint':
      return ['life_constraints'];
    case 'set_study_goal':
      return [studyGoalIdentity(command.goal.title)];
    default:
      return [];
  }
}

function referencedFields(command: ParsedWeeklyPlanningCommand): string[] {
  switch (command.type) {
    case 'set_priority_policy':
      return command.policy.kind === 'field_first' ? command.policy.order : [];
    case 'mark_completed_units':
      return [command.field];
    case 'mark_completion_target':
      return command.field ? [command.field] : [];
    case 'note_progress_boundary':
      return command.field ? [command.field] : [];
    default:
      return [];
  }
}

function hasUnknownField(command: ParsedWeeklyPlanningCommand, knownFields: string[]): boolean {
  const references = referencedFields(command);

  return knownFields.length > 0 && references.some((field) => !knownFields.includes(field));
}

function addRejected(
  result: CandidateValidationResult,
  candidate: InterpretedCommandCandidate,
  reason: string,
): void {
  result.rejected.push({ candidate, reason });
}

function removeCandidateFromAcceptedResults(
  result: CandidateValidationResult,
  candidate: InterpretedCommandCandidate,
): void {
  result.accepted = result.accepted.filter((command) => command !== candidate.command);
  result.acceptedWithConfirmation = result.acceptedWithConfirmation.filter(
    (command) => command !== candidate.command,
  );
  result.clarifications = result.clarifications.filter((item) => item !== candidate);
}

export function validateInterpretedCandidates(
  candidates: InterpretedCommandCandidate[],
  summary: InterpreterStateSummary,
  context?: WeeklyPlanningIntakeContext,
): CandidateValidationResult {
  const result: CandidateValidationResult = {
    accepted: [],
    acceptedWithConfirmation: [],
    clarifications: [],
    clarificationRequests: [],
    rejected: [],
    parseRejections: [],
  };
  const occupiedSlots = new Map<string, { rank: number; candidate: InterpretedCommandCandidate }>();

  candidates.forEach((candidate) => {
    const rawCommand = candidate.command;

    const type = commandType(rawCommand);

    if (!type || !KNOWN_COMMAND_TYPES.has(type)) {
      addRejected(result, candidate, 'unknown-command-type');
      return;
    }

    if (!isValidWeeklyPlanningCommand(rawCommand)) {
      addRejected(result, candidate, 'invalid-command-shape');
      return;
    }

    let command = rawCommand;
    let effectiveCandidate = candidate;
    if (command.type === 'set_exam_scope') {
      const enrichment = normalizeExamScopeEnrichment(command, summary.examScopeSummary);
      if (!enrichment.command) {
        addRejected(result, candidate, enrichment.error ?? 'confirmed-slot-overwrite');
        return;
      }
      command = enrichment.command;
      effectiveCandidate = command === candidate.command ? candidate : { ...candidate, command };
    }
    const groundingError = validateCommandGrounding(candidate, command, summary, context);
    if (groundingError) {
      addRejected(result, effectiveCandidate, groundingError);
      return;
    }

    const enumError = validateEnumVocabulary(command);

    if (enumError) {
      addRejected(result, effectiveCandidate, enumError);
      return;
    }

    const valueError = validateValueRange(command);

    if (valueError) {
      addRejected(result, effectiveCandidate, valueError);
      return;
    }

    if (
      command.type === 'set_planning_range'
      && context
      && !isPlanningRangeConsistentWithAbsoluteDateSource({
        sourceText: command.sourceSegment ?? command.sourceText,
        selectedDate: context.selectedDate,
        startDateTime: command.range.startDateTime,
      })
    ) {
      addRejected(result, effectiveCandidate, 'planning-range-absolute-date-mismatch');
      return;
    }

    if (command.type === 'use_constraint_source') {
      const resolution = candidate.constraintSourceResolution;
      if (resolution && resolution.status !== 'resolved') {
        if (resolution.clarificationRequest) {
          result.clarificationRequests.push(resolution.clarificationRequest);
        }
        addRejected(result, candidate, `constraint-source-reference-${resolution.status}`);
        return;
      }

      if (!constraintSourceAvailable(command.source, summary)) {
        addRejected(result, candidate, 'constraint-source-unavailable');
        return;
      }
    }

    if (command.type === 'request_clarification') {
      result.clarificationRequests.push(command);
      return;
    }

    if (command.type === 'set_planning_range' && summary.pendingPlanningRange) {
      const rangeStartDate = command.range.startDateTime?.slice(0, 10);
      const rangeEndDate = command.range.endDateTime?.slice(0, 10);
      if (command.range.confidence !== 'explicit' || !rangeStartDate || !rangeEndDate) {
        addRejected(result, candidate, 'pending-range-clarification');
        return;
      }

      const pendingStartDate = summary.pendingPlanningRange.windowStartDate;
      const pendingEndDate = summary.pendingPlanningRange.windowEndDate;
      if ((pendingStartDate && rangeStartDate < pendingStartDate)
        || (pendingEndDate && rangeStartDate > pendingEndDate)) {
        addRejected(result, candidate, 'pending-range-outside-window');
        return;
      }
      if (
        summary.pendingPlanningRange.planningEndDateTime
        && command.range.endDateTime !== summary.pendingPlanningRange.planningEndDateTime
      ) {
        addRejected(result, candidate, 'pending-range-end-mismatch');
        return;
      }
    }

    const slots = commandSlotKeys(command);

    const confirmedOverlaps = slots.filter((slot) => summary.confirmedSlots.includes(slot));
    if (
      confirmedOverlaps.length > 0
      && command.type !== 'set_exam_scope'
    ) {
      addRejected(result, effectiveCandidate, 'confirmed-slot-overwrite');
      return;
    }

    const rank = CONFIDENCE_RANK[command.confidence];
    const conflictingSlot = slots.find((slot) => occupiedSlots.has(slot));

    if (conflictingSlot) {
      const existing = occupiedSlots.get(conflictingSlot);
      if (existing && existing.rank >= rank) {
        addRejected(result, effectiveCandidate, 'conflicting-slot-lower-confidence');
        return;
      }

      if (existing) {
        removeCandidateFromAcceptedResults(result, existing.candidate);
        addRejected(result, existing.candidate, 'conflicting-slot-lower-confidence');
        Array.from(occupiedSlots.entries()).forEach(([slot, occupied]) => {
          if (occupied.candidate === existing.candidate) {
            occupiedSlots.delete(slot);
          }
        });
      }
    }

    slots.forEach((slot) => occupiedSlots.set(slot, { rank, candidate: effectiveCandidate }));

    if (command.confidence === 'low') {
      result.clarifications.push(effectiveCandidate);
      return;
    }

    if (command.confidence === 'medium'
      || candidate.needsConfirmation
      || requiresTypoConfirmation(candidate, command)
      || hasUnknownField(command, summary.knownFields)) {
      result.acceptedWithConfirmation.push(command);
      return;
    }

    result.accepted.push(command);
  });

  return result;
}
