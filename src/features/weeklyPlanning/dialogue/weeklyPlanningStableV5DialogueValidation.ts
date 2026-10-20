import { composeDurationMinutes, parseJapaneseInteger } from '../../../services/durationConversion';
import {
  groundedDateExpressionsFromPlanningInformation,
} from './weeklyPlanningDialogueDateGrounding';
import type {
  WeeklyPlanningStableV5DialogueFallbackReason,
  WeeklyPlanningStableV5DialogueRenderInput,
  WeeklyPlanningStableV5DialogueRenderResult,
} from './weeklyPlanningStableV5DialogueContracts';

// Display claims are compared to typed graph values, including fractional minutes.
// D5 candidate eligibility (integer-only, <=1440) is deliberately a separate contract.
const DISPLAY_NUMBER = '[0-9０-９〇零一二三四五六七八九十百]+(?:[.．][0-9０-９]+)?';
const DISPLAY_QUANTITY = new RegExp(`(${DISPLAY_NUMBER})(?:時間(?:(半)|(${DISPLAY_NUMBER})分)?|(分))?`, 'gu');
function displayQuantityMentions(text: string): { minutes: number; form: 'bare' | 'duration'; span: { start: number; end: number }; approximate: boolean }[] | null {
  if (new RegExp(`(?:${DISPLAY_NUMBER})\\s*(?:[,，:：/／〜～~\\-−–—]|から)\\s*(?:${DISPLAY_NUMBER})`, 'u').test(text)) return null;
  const result = [];
  for (const match of text.matchAll(DISPLAY_QUANTITY)) {
    const start = match.index!; const end = start + match[0].length;
    if (/[.．千万元億兆\-−–—]/u.test(text[start - 1] ?? '') || /[千万元億兆]/u.test(text[end] ?? '')) return null;
    const value = parseJapaneseInteger(match[1].normalize('NFKC'));
    const extra = match[2] ? 30 : match[3] ? parseJapaneseInteger(match[3].normalize('NFKC')) : 0;
    if (value === null || extra === null) return null;
    const minutes = match[0].includes('時間') ? composeDurationMinutes(value, extra) : value;
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    result.push({ minutes, span: { start, end }, form: match[0].includes('時間') || match[4] ? 'duration' as const : 'bare' as const,
      approximate: /くらい|ぐらい|ほど|前後|約|程度|およそ|大体|だいたい/u.test(text) });
  }
  return result;
}

const MAX_RENDERED_TEXT_LENGTH = 800;
const EXTERNAL_DESTINATION = /https?:\/\/|www\.|(?<![a-z0-9.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?![a-z0-9.-])/i;
// These are the application's own mutation outcomes, not a vocabulary of
// attacker phrases. A renderer question/status/preview cannot perform them.
const APPLICATION_MUTATION_OUTCOME = /(?:保存|作成|登録|追加|削除|承認|反映|確定|適用|スケジュール)(?:を|が|は|も)?(?:しました|されました|いたしました|しています|できました|完了(?:しました|しています)?|済み(?:です|でした)?)/;
const SENSITIVE_VALUE = /(?:パスワード|暗証番号|秘密情報|APIキー|アクセストークン|口座番号|クレジットカード)/i;
// Keep malformed separators/precision in the token; never accept only a valid prefix.
const CLOCK_EXPRESSION = /(?<!\d)(?:午前|午後)?\s*\d+(?:[.．]+\d+)*(?:[:：]+\d{2,}(?:[:：]\d*|[.．]\d+|分|秒|半)*|\s*時(?!間)(?:\s*(?:\d+(?:[.．]\d+)?\s*(?:分|秒)|半|[:：]\d*|[.．]\d+))*)/g;
const DATE_EXPRESSION = /(?:今日|明日|明後日|今週|来週|週末)|\d{1,2}\s*月\s*\d{1,2}\s*日/g;
const PREVIEW_COUNT_EXPRESSION = /(\d+)\s*件/g;
const EXECUTION_VERB = '(?:作ります|作成します|追加します|登録します|保存します|組みます|反映します|入れます|入れました|入れておきます)';
const EXECUTION_CLAIM_EXPRESSION = new RegExp(
  `(?:(?:予定|仮予定|計画).{0,20}${EXECUTION_VERB}|${EXECUTION_VERB}.{0,20}(?:予定|仮予定|計画))`,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeProtectedExpression(value: string): string {
  return value.replace(/[\s：]/g, '').replace(/:/g, '');
}

function normalizeDialogueText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeSafetyText(value: string): string {
  return value.normalize('NFKC').replace(/\p{Cf}/gu, '');
}

function groundedDisplayLabels(input: WeeklyPlanningStableV5DialogueRenderInput): string[] {
  const labels = [...input.requiredLabels];
  const collections: Array<[string, string[]]> = [
    ['tasks', ['title']],
    ['components', ['label']],
    ['studyContexts', ['contextLabel']],
    ['registeredMaterials', ['name', 'catalogTitle']],
  ];
  for (const [collection, fields] of collections) {
    const entries = input.planningInformation?.[collection];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      for (const field of fields) {
        if (typeof entry[field] === 'string') labels.push(entry[field] as string);
      }
      if (collection === 'registeredMaterials' && Array.isArray(entry.aliases)) {
        labels.push(...entry.aliases.filter((alias): alias is string => typeof alias === 'string'));
      }
    }
  }
  return labels;
}

function withoutGroundedQuotedData(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): string {
  const grounded = [input.currentUserMessage, ...groundedDisplayLabels(input)]
    .map(normalizeSafetyText)
    .filter((value) => value.length > 0);
  return text.replace(/「([^」]*)」|『([^』]*)』|"([^"]*)"/g, (quoted, japanese, alternate, doubleQuoted) => {
    const value = japanese ?? alternate ?? doubleQuoted;
    if (!grounded.some((source) => source.includes(value) && value.length > 0)) return quoted;
    return '〈引用データ〉';
  });
}

function withoutGroundedRegistrationModifiers(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): string {
  const materials = input.planningInformation?.registeredMaterials;
  if (!Array.isArray(materials)) return text;
  const labels = materials.flatMap((material) => {
    if (!isRecord(material) || typeof material.materialId !== 'string'
      || material.materialId.trim().length === 0) return [];
    return [material.name, material.catalogTitle,
      ...(Array.isArray(material.aliases) ? material.aliases : [])]
      .filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
      .map(normalizeSafetyText)
      .filter((label) => label.trim().length > 0);
  });
  // Registration is an existing attribute only for a noun grounded in the
  // current owner-filtered registry. It does not evidence any new operation.
  // Remove only the modifier; other predicates in the noun or sentence remain.
  return text.replace(/登録済みの/gu, (modifier, offset: number, whole: string) => {
    const following = whole.slice(offset + modifier.length);
    const groundedNoun = labels.some((label) =>
      [label, `「${label}」`, `『${label}』`, `"${label}"`].some((noun) =>
        following.startsWith(noun)
        && /^(?:$|[\s。、，,.!?！？:：;；]|[をがはもにへとでの]|から|まで)/u.test(following.slice(noun.length))));
    return groundedNoun ? '〈登録教材参照〉' : modifier;
  });
}

function safetyNarrative(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): string {
  const normalized = normalizeSafetyText(text);
  const withoutReferences = withoutGroundedRegistrationModifiers(normalized, input);
  const withoutQuotes = withoutGroundedQuotedData(withoutReferences, input);
  const fallback = normalizeSafetyText(input.fallbackText);
  let narrative = fallback.length > 0 ? withoutQuotes.split(fallback).join('') : withoutQuotes;
  for (const fact of input.currentTurnGrounding?.acceptedFacts ?? []) {
    if (fact.kind !== 'workload' || fact.data.quantityRole !== 'completed') continue;
    const amount = fact.data.amount;
    const unit = fact.data.unitLabel;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || typeof unit !== 'string') continue;
    const groundedProgress = normalizeSafetyText(`${amount}${unit}まで完了している`);
    narrative = narrative.split(groundedProgress).join('〈進捗〉');
  }
  return narrative;
}

function containsExternalDestination(text: string): boolean {
  return EXTERNAL_DESTINATION.test(normalizeSafetyText(text));
}

function containsSensitiveValue(text: string): boolean {
  return SENSITIVE_VALUE.test(normalizeSafetyText(text));
}

function expressions(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map((match) => normalizeProtectedExpression(match[0]));
}

function clockMinutes(value: string): number | null {
  const compact = value.replace(/\s+/g, '').replace('：', ':');
  const colon = /^(午前|午後)?(\d{1,2}):(\d{2})$/.exec(compact);
  const japanese = /^(午前|午後)?(\d{1,2})時(?:(\d{1,2})分|半)?$/.exec(compact);
  const parsed = colon ?? japanese;
  if (!parsed) return null;
  const meridiem = parsed[1];
  let hour = Number(parsed[2]);
  const minute = parsed[3] !== undefined
    ? Number(parsed[3])
    : compact.endsWith('半') ? 30 : 0;
  // Calendar day-end is distinct from the following day's midnight.
  if (!meridiem && hour === 24 && minute === 0) return 24 * 60;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59
    || (meridiem && hour > 12)) return null;
  if (meridiem === '午前' && hour === 12) hour = 0;
  if (meridiem === '午後' && hour < 12) hour += 12;
  return hour * 60 + minute;
}

function clockValues(value: string): number[] {
  return [...value.matchAll(CLOCK_EXPRESSION)]
    .map((match) => clockMinutes(match[0]))
    .filter((minutes): minutes is number => minutes !== null);
}

function structuredClockValues(data: Record<string, unknown>): number[] {
  return ['startTime', 'endTime']
    .map((key) => data[key])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => clockMinutes(value))
    .filter((minutes): minutes is number => minutes !== null);
}

function missesAcknowledgedClockValue(params: {
  factIds: string[];
  acknowledgementText: string;
  input: WeeklyPlanningStableV5DialogueRenderInput;
}): boolean {
  const acceptedFacts = params.input.currentTurnGrounding?.acceptedFacts ?? [];
  const actual = new Set(clockValues(params.acknowledgementText));
  return params.factIds.some((factId) => {
    const fact = acceptedFacts.find((candidate) => candidate.factId === factId);
    if (!fact) return true;
    const structured = structuredClockValues(fact.data);
    const expected = structured.length > 0
      ? structured
      : clockValues(fact.sourceText);
    return expected.some((minutes) => !actual.has(minutes));
  });
}

function addsUnsupportedExpression(
  rendered: string,
  groundingInformation: string,
  pattern: RegExp,
  additionalAllowedValues: readonly string[] = [],
): boolean {
  if (pattern === CLOCK_EXPRESSION) {
    const allowedMinutes = new Set(clockValues(groundingInformation));
    return [...rendered.matchAll(CLOCK_EXPRESSION)].some((match) => {
      const minutes = clockMinutes(match[0]);
      return minutes === null || !allowedMinutes.has(minutes);
    });
  }
  const allowed = new Set(expressions(groundingInformation, pattern));
  for (const value of additionalAllowedValues) {
    for (const expression of expressions(value, pattern)) {
      allowed.add(expression);
    }
  }
  return expressions(rendered, pattern).some((expression) => !allowed.has(expression));
}

function hasIncorrectPreviewCount(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  if (input.actionKind !== 'preview_ready') return false;
  const mentionedCounts = [...text.matchAll(PREVIEW_COUNT_EXPRESSION)]
    .map((match) => Number(match[1]));
  return mentionedCounts.some((count) => count !== input.previewCount);
}

function missesPreviewPromotionControl(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  return input.actionKind === 'preview_ready'
    && typeof input.previewPromotionControlLabel === 'string'
    && input.previewPromotionControlLabel.length > 0
    && !text.includes(input.previewPromotionControlLabel);
}

function claimsUnexecutedAction(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  let narrative = safetyNarrative(text, input);
  const hasPreview = input.actionKind === 'preview_ready' && input.previewCount > 0
    && Boolean(input.previewPromotionControlLabel)
    && text.includes(input.previewPromotionControlLabel!);
  if (hasPreview) {
    // This bounded relation references the schedule actually used for placement.
    // It does not license a saved-candidate copula, saved-plan creation, or any
    // other result predicate. Unknown reference constructions still fail closed.
    if (input.existingScheduleGrounding?.occupiedEventIds.length) {
      narrative = narrative.replace(
        /(^|[。！？!?\n])(\s*)保存済みの予定(?=と重ならない候補(?:\s*\d+\s*件(?:を)?|を(?:\s*\d+\s*件)?)?\s*作成しました)/gu,
        '$1$2〈既存予定〉',
      );
    }
    // Creation of the presented draft is already evidenced. Only its direct
    // object is exempt; another object or a destination is not that draft.
    narrative = narrative.replace(
      /(?:候補(?:\s*\d+\s*件(?:を)?|を(?:\s*\d+\s*件)?)?|(?:仮予定|予定|計画)(?:案)?を)\s*作成しました/gu,
      (claim, offset: number, whole: string) => {
        const clause = whole.slice(0, offset).split(/[。、！？!?\n]/u).pop() ?? '';
        return /[にへで]/u.test(clause) ? claim : claim.replace('作成しました', '〈候補提示〉');
      },
    );
  }
  // A question only exempts the action predicate it directly follows. A later
  // question in the same sentence cannot excuse an earlier completion claim.
  const sentences = narrative.match(/[^。！？!?\n]+[。！？!?\n]?/g) ?? [];
  const isUnquestionedMatch = (sentence: string, pattern: RegExp): boolean =>
    [...sentence.matchAll(new RegExp(pattern.source, 'g'))].some((match) => {
      const ending = sentence.slice((match.index ?? 0) + match[0].length);
      return !/^\s*(?:(?:か|でしょうか|ですか)\s*[?？]?|[?？])\s*$/.test(ending);
    });
  return sentences.some((sentence) =>
    isUnquestionedMatch(sentence, APPLICATION_MUTATION_OUTCOME)
    || isUnquestionedMatch(sentence, EXECUTION_CLAIM_EXPRESSION));
}

function repeatsMostRecentAssistantQuestion(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  if (input.actionKind !== 'question') return false;
  const previousAssistant = [...input.recentConversation]
    .reverse()
    .find((turn) => turn.role === 'assistant');
  if (!previousAssistant) return false;
  const previousText = normalizeDialogueText(previousAssistant.content);
  const currentText = normalizeDialogueText(text);
  return previousText.length > 0 && currentText === previousText;
}

/** Checks visible renderer claims against typed accepted effort; never interprets user intent. */
function effortAcknowledgementMismatch(factIds: readonly string[], text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput): boolean {
  const effort = (input.currentTurnGrounding?.acceptedFacts ?? []).filter(f => f.kind === 'effort_estimate');
  if (!effort.length) return false;
  const visible = normalizeSafetyText(text);
  const assigned = new Set<string>();
  // This is a renderer display contract: each effort claim has its own visible clause.
  // Never combine an identity in one clause with a value/precision in another.
  const taskLabels = new Set<string>();
  for (const fact of effort) {
    const label = Array.isArray(fact.data.targetLabels) ? fact.data.targetLabels[0] : null;
    if (typeof label === 'string' && label.length) taskLabels.add(normalizeSafetyText(label));
  }
  const tasks = input.planningInformation?.tasks;
  if (Array.isArray(tasks)) for (const task of tasks) {
    if (isRecord(task) && typeof task.title === 'string' && task.title.length) taskLabels.add(normalizeSafetyText(task.title));
  }
  const opaqueLabels = [...new Set([...taskLabels, ...effort.flatMap(fact => Array.isArray(fact.data.targetLabels) ? fact.data.targetLabels : [])
    .filter((label): label is string => typeof label === 'string').map(normalizeSafetyText)])].sort((a, b) => b.length - a.length);
  // Locate literal names before punctuation is considered. Their contents are opaque,
  // including question marks, numbers and words resembling an assertion predicate.
  const spans: { start: number; end: number; label: string }[] = [];
  for (let at = 0; at < visible.length; at++) {
    const label = opaqueLabels.find(label => label.length && visible.startsWith(label, at));
    if (!label || /[A-Za-zⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/u.test(visible[at + label.length] ?? '')) continue;
    spans.push({ start: at, end: at + label.length, label }); at += label.length - 1;
  }
  const boundaries: { start: number; end: number }[] = [];
  let start = 0;
  for (let at = 0; at < visible.length; at++) {
    const opaque = spans.find(span => span.start === at);
    if (opaque) { at = opaque.end - 1; continue; }
    if (/[。！？!?\n]/u.test(visible[at])) { boundaries.push({ start, end: at + 1 }); start = at + 1; }
  }
  if (start < visible.length) boundaries.push({ start, end: visible.length });
  const segments = boundaries.flatMap<{ label: string | null; text: string }>(boundary => {
    const anchors = spans.filter(span => span.start >= boundary.start && span.end <= boundary.end && taskLabels.has(span.label));
    return anchors.length ? anchors.map((anchor, i) => ({ label: anchor.label,
      text: visible.slice(i === 0 ? boundary.start : anchor.start, anchors[i + 1]?.start ?? boundary.end) }))
      : [{ label: null, text: visible.slice(boundary.start, boundary.end) }];
  });
  for (const { text: segment, label: targetLabel } of segments) {
    let assertion = segment;
    for (const label of opaqueLabels) if (label.length) assertion = assertion.split(label).join(' '.repeat(label.length));
    assertion = assertion.replace(CLOCK_EXPRESSION, clock => ' '.repeat(clock.length));
    const mentions = displayQuantityMentions(assertion);
    if (!mentions) return true;
    const durations = mentions.filter(m => m.form !== 'bare');
    if (!durations.length) continue;
    if (durations.length !== 1) return true;
    const duration = durations[0];
    // Only the effort assertion's own ending is checked. A subsequent ordinary
    // question is outside the ACK; punctuation inside names has already been masked.
    const ending = assertion.slice(duration.span.end).trim();
    if (!/^(?:(?:くらい|ぐらい|ほど|前後|程度)\s*)?(?:です|でした|になります|とします|(?:で|と|として)(?:見積もります|見積もりました|計算します|計算しました|反映します|反映しました|設定します|設定しました|扱います|受け取りました|承知しました)|と見込んでいます|を目安にします)?[\s。、,「」『』()（）]*$/u.test(ending)) return true;
    const matching = effort.filter(fact => {
      const data = fact.data; const labels = data.targetLabels;
      if (!factIds.includes(fact.factId) || assigned.has(fact.factId)
        || duration.minutes !== data.minutes || (data.precision === 'approximate') !== duration.approximate
        || !Array.isArray(labels) || !labels.length || typeof labels[0] !== 'string'
        || normalizeSafetyText(labels[0]) !== targetLabel
        || !labels.every(label => typeof label === 'string' && segment.includes(normalizeSafetyText(label)))) return false;
      const total = /全部|合計|全体|総計|トータル/u.test(assertion);
      const unit = data.kind === 'session_duration' ? '回' : data.unitLabel;
      let perUnit = false; let measurementStart = data.kind === 'total_duration'
        ? assertion.search(/全部|合計|全体|総計|トータル/u) : -1;
      if (typeof unit === 'string' && unit.length > 0) {
        const literal = normalizeSafetyText(unit);
        let at = assertion.indexOf(literal);
        while (at >= 0) {
          const denominator = mentions.find(m => m.form === 'bare' && m.span.end <= at
            && assertion.slice(m.span.end, at).trim() === '');
          const rateSuffix = /^(?:あたり|当たり|につき)/u.test(assertion.slice(at + literal.length));
          if (denominator ? denominator.minutes === 1 : rateSuffix) { perUnit = true; measurementStart = denominator?.span.start ?? at; }
          if (denominator && denominator.minutes !== 1 && (rateSuffix || data.kind !== 'total_duration')) return false;
          at = assertion.indexOf(literal, at + literal.length);
        }
      }
      if (data.kind === 'total_duration' ? !total || perUnit : !perUnit || total) return false;
      const labelEnd = Math.max(...labels.map(label => { const normalized = normalizeSafetyText(label); return segment.lastIndexOf(normalized) + normalized.length; }));
      const subjectLink = segment.slice(labelEnd, measurementStart);
      return measurementStart >= labelEnd && /^(?:(?:について|として|に関して)|[\sはがをのにで、,:：「」『』()（）])*$/u.test(subjectLink);
    });
    if (matching.length !== 1) return true;
    assigned.add(matching[0].factId);
  }
  return effort.some(fact => !assigned.has(fact.factId));
}

function groundingAcknowledgementMismatch(
  value: unknown,
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  const mode = input.currentTurnGrounding?.mode ?? 'none';

  /*
   * groundingAcknowledgement is control metadata for facts accepted on the
   * current turn. When mode=none there are no such facts to bind, so a model
   * may redundantly populate the metadata without changing the visible text's
   * meaning. Ignore that unused object and continue to validate the text itself
   * against the normal grounding and safety checks below.
   */
  if (mode === 'none') {
    return value !== undefined && value !== null && !isRecord(value);
  }

  if (value === undefined || value === null) {
    return mode === 'required_before_resume';
  }
  if (!isRecord(value)) return true;

  const factIds = value.factIds;
  const acknowledgementText = value.text;
  if (
    !Array.isArray(factIds)
    || factIds.length === 0
    || !factIds.every((factId) => typeof factId === 'string' && factId.length > 0)
    || typeof acknowledgementText !== 'string'
    || normalizeDialogueText(acknowledgementText).length === 0
  ) {
    return true;
  }

  const acceptedFactIds = new Set(
    (input.currentTurnGrounding?.acceptedFacts ?? []).map((fact) => fact.factId),
  );
  if (
    acceptedFactIds.size === 0
    || factIds.some((factId) => !acceptedFactIds.has(factId as string))
  ) {
    return true;
  }

  if (effortAcknowledgementMismatch(factIds as string[], acknowledgementText, input)) return true;

  if (missesAcknowledgedClockValue({
    factIds: factIds as string[],
    acknowledgementText,
    input,
  })) {
    return true;
  }

  const normalizedAck = normalizeDialogueText(acknowledgementText);
  const normalizedText = normalizeDialogueText(text);
  if (!normalizedText.startsWith(normalizedAck)) return true;
  if ((input.currentTurnGrounding?.acceptedFacts ?? []).some(f => f.kind === 'effort_estimate')) {
    // Effort claims belong to the checked ACK. Its metadata cannot license a
    // contradictory continuation. Clock questions retain their separate grounding gate.
    const tail = normalizedText.slice(normalizedAck.length).replace(CLOCK_EXPRESSION, '');
    const mentions = displayQuantityMentions(tail);
    if (!mentions || mentions.some(m => m.form !== 'bare')) return true;
  }
  return false;
}

function addsUngroundedDuration(text: string, input: WeeklyPlanningStableV5DialogueRenderInput): boolean {
  const values = (source: string) => (displayQuantityMentions(normalizeSafetyText(source).replace(CLOCK_EXPRESSION, '')) ?? [])
    .filter(m => m.form !== 'bare').map(m => m.minutes);
  const actual = values(text);
  if (!actual.length) return false;
  const allowed = new Set([input.currentUserMessage, input.fallbackText, ...input.recentConversation.map(turn => turn.content)].flatMap(values));
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isRecord(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'number' && Number.isFinite(entry) && /minutes$/i.test(key)) allowed.add(entry);
      else if (typeof entry === 'string') values(entry).forEach(minutes => allowed.add(minutes));
      else if (typeof entry === 'object' && entry !== null) visit(entry);
    }
    if ((value.unitCode === 'minute' || value.unitCode === 'hour') && typeof value.amount === 'number') {
      allowed.add(value.amount * (value.unitCode === 'hour' ? 60 : 1));
    }
  };
  visit(input.planningInformation); visit(input.currentTurnGrounding?.acceptedFacts);
  return actual.some(minutes => !allowed.has(minutes));
}

function validateRenderedText(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): WeeklyPlanningStableV5DialogueFallbackReason | null {
  if (
    text.length === 0
    || text.length > MAX_RENDERED_TEXT_LENGTH
    || containsExternalDestination(text)
    || containsSensitiveValue(text)
  ) {
    return 'unsafe_text';
  }

  if (missesPreviewPromotionControl(text, input)) {
    return 'action_contract_mismatch';
  }

  if (repeatsMostRecentAssistantQuestion(text, input)) {
    return 'repeated_question_text';
  }

  const groundingInformation = JSON.stringify({
    currentUserMessage: input.currentUserMessage,
    recentConversation: input.recentConversation,
    planningInformation: input.planningInformation,
    conversationReferences: input.referenceContext ?? null,
    requiredLabels: input.requiredLabels,
    previewPromotionControlLabel: input.previewPromotionControlLabel ?? null,
    previewCount: input.previewCount,
  });
  const groundedDateExpressions = groundedDateExpressionsFromPlanningInformation(
    input.planningInformation,
  );
  if (
    addsUngroundedDuration(text, input)
    || addsUnsupportedExpression(text, groundingInformation, CLOCK_EXPRESSION)
    || addsUnsupportedExpression(
      text,
      groundingInformation,
      DATE_EXPRESSION,
      groundedDateExpressions,
    )
    || hasIncorrectPreviewCount(text, input)
    || claimsUnexecutedAction(text, input)
  ) {
    return 'ungrounded_text';
  }

  return null;
}

export function parseWeeklyPlanningStableV5DialogueRendererResponse(
  rawResponse: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): WeeklyPlanningStableV5DialogueRenderResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { status: 'fallback', reason: 'invalid_json', rawResponse };
  }

  if (
    !isRecord(parsed)
    || typeof parsed.actionId !== 'string'
    || typeof parsed.actionKind !== 'string'
    || (parsed.questionCode !== null && typeof parsed.questionCode !== 'string')
    || typeof parsed.text !== 'string'
  ) {
    return { status: 'fallback', reason: 'invalid_shape', rawResponse };
  }

  if (parsed.actionId !== input.actionId) {
    return { status: 'fallback', reason: 'action_mismatch', rawResponse };
  }
  if (
    parsed.actionKind !== input.actionKind
    || parsed.questionCode !== input.questionCode
  ) {
    return { status: 'fallback', reason: 'action_contract_mismatch', rawResponse };
  }

  const text = parsed.text.replace(/\r\n/g, '\n').trim();
  if (groundingAcknowledgementMismatch(
    parsed.groundingAcknowledgement,
    text,
    input,
  )) {
    return { status: 'fallback', reason: 'grounding_contract_mismatch', rawResponse };
  }

  const validationError = validateRenderedText(text, input);
  if (validationError) {
    return { status: 'fallback', reason: validationError, rawResponse };
  }

  return { status: 'rendered', text, rawResponse };
}
