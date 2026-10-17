import type {
  FocusedContextualAnswerDecisionV5,
  FocusedContextualTargetV5,
} from './weeklyPlanningFocusedContextualAnswerV5';

/**
 * Closed, whole-utterance grammar for answers to one machine-bound effort question.
 *
 * Grammar:
 *   [approximation] [total | 1 <typed unit>] <duration> [approximation] [です] [。]
 *   duration := <decimal> 分 | <decimal> 時間 [半 | <integer> 分]
 *
 * This deliberately does not parse free-form Japanese or infer a target. Every
 * unconsumed character, extra clause, negation, missing unit, target change,
 * or unsupported form falls back to the existing Jev/Luna semantic pipeline.
 */
const MAX_INPUT_CODEPOINTS = 36;
// Extremely long totals need contextual interpretation, even with an explicit unit.
const MAX_TOTAL_MINUTES = 24 * 60;
const MAX_PER_UNIT_MINUTES = 12 * 60;

const RATE_MARKERS = {
  problem: '問',
  page: 'ページ',
  word: '単語',
  lesson: 'レッスン',
  chapter: '章',
  section: '節',
  exam_year: '年分',
  session: '回',
} as const;

type SupportedMeasurement = 'total_duration' | 'duration_per_unit';

function takeLeading(text: string, tokens: readonly string[]): [string, string | null] {
  for (const token of tokens) {
    if (text.startsWith(token)) return [text.slice(token.length), token];
  }
  return [text, null];
}

function readDecimal(text: string): { value: number; rest: string; fractional: boolean } | null {
  const match = /^(?:0|[1-9][0-9]{0,3})(?:\.[0-9])?/.exec(text);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? {
    value, rest: text.slice(match[0].length), fractional: match[0].includes('.'),
  } : null;
}

function readDuration(text: string): { minutes: number; rest: string } | null {
  const number = readDecimal(text);
  if (!number) return null;

  if (number.rest.startsWith('分')) {
    return { minutes: number.value, rest: number.rest.slice(1) };
  }
  if (!number.rest.startsWith('時間')) return null;

  let minutes = number.value * 60;
  let rest = number.rest.slice(2);
  if (rest.startsWith('半')) {
    // "1.5時間半" is ambiguous; do not combine fractions.
    if (number.fractional) return null;
    minutes += 30;
    rest = rest.slice(1);
  } else if (rest && /^[0-9]/.test(rest)) {
    // A compound amount is one duration, never two separate destinations.
    if (number.fractional) return null;
    const extra = readDecimal(rest);
    if (!extra || extra.fractional || extra.value >= 60 || !extra.rest.startsWith('分')) return null;
    minutes += extra.value;
    rest = extra.rest.slice(1);
  }
  return { minutes, rest };
}

export function parseMachineBoundEffortAnswerV5(params: {
  userText: string;
  measurement: SupportedMeasurement;
  unitCode: FocusedContextualTargetV5['unitCode'];
}): FocusedContextualAnswerDecisionV5 | null {
  const original = params.userText;
  if (!original.trim() || Array.from(original).length > MAX_INPUT_CODEPOINTS) return null;
  let text = original.normalize('NFKC').trim();
  if (!text || text.includes('\n') || text.includes('\r')) return null;

  [text] = takeLeading(text, ['だいたい', '大体', 'およそ', '約']);
  const hasApproxPrefix = text !== original.normalize('NFKC').trim();

  const [withoutTotalQualifier, totalQualifier] = takeLeading(
    text, ['合計で', '全部で', '全体で', '合計'],
  );
  if (totalQualifier) {
    if (params.measurement !== 'total_duration') return null;
    text = withoutTotalQualifier;
  }

  const marker = RATE_MARKERS[params.unitCode as keyof typeof RATE_MARKERS];
  let hasRate = false;
  if (marker && text.startsWith('1' + marker)) {
    if (params.measurement !== 'duration_per_unit') return null;
    text = text.slice(1 + marker.length);
    hasRate = true;
  }

  const duration = readDuration(text);
  if (!duration) return null;
  text = duration.rest;

  if (hasRate && text.startsWith('ペース')) text = text.slice(3);
  const [withoutSuffix, approximationSuffix] = takeLeading(
    text, ['くらい', 'ぐらい', '程度', 'ほど'],
  );
  text = withoutSuffix;
  if (text.startsWith('です')) text = text.slice(2);
  if (text.startsWith('。')) text = text.slice(1);

  // Reject punctuation chains, units without a value, extra clauses, and
  // partially parsed numbers instead of silently discarding their meaning.
  if (text !== '' || !Number.isSafeInteger(duration.minutes)
    || duration.minutes <= 0 || duration.minutes > (
      params.measurement === 'duration_per_unit'
        ? MAX_PER_UNIT_MINUTES : MAX_TOTAL_MINUTES
    )) return null;

  return {
    decision: 'effort_answer',
    effortTarget: 'question_target',
    effortMeasurement: params.measurement,
    minutes: duration.minutes,
    precision: hasApproxPrefix || approximationSuffix ? 'approximate' : 'exact',
    quantityRole: null,
  };
}
