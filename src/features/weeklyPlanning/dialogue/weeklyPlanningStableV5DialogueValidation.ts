import { composeDurationMinutes, parseJapaneseInteger } from '../../../services/durationConversion';
import {
  groundedDateExpressionsFromPlanningInformation,
} from './weeklyPlanningDialogueDateGrounding';
import type {
  WeeklyPlanningStableV5DialogueFallbackReason,
  WeeklyPlanningStableV5DialogueRenderInput,
  WeeklyPlanningStableV5DialogueRenderResult,
  WeeklyPlanningStableV5DialogueGroundingFact,
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

function acknowledgedClockValues(value: string): number[] {
  const values = clockValues(value);
  // Renderer display only: an omitted 時/:00 is explicit at the start of a
  // clock range. Keep the ordinary body/source clock validator unchanged.
  const range = new RegExp(`(?<![\\d.．:：+\\-－−–])([0-9]{1,2})\\s*[〜~～\\-－–]\\s*(${CLOCK_EXPRESSION.source})`, 'g');
  for (const match of value.matchAll(range)) {
    const hour = Number(match[1]);
    if (hour <= 24 && clockMinutes(match[2]) !== null) values.push(hour * 60);
  }
  return values;
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
  const actual = new Set(acknowledgedClockValues(params.acknowledgementText));
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
    && Boolean(input.previewPromotionControlLabel);
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

// Bounded renderer-display grammar, never interpretation of raw user intent.
const EFFORT_SUBJECT_CONNECTOR = /^(?:(?:について|として|に関して)|[\sはがをのにで、,:：「」『』()（）])*$/u;
const AFFIRMATIVE_EFFORT_ENDING = /^(?:(?:くらい|ぐらい|ほど|前後|程度)\s*)?(?:です(?:ね|よ)?|でした(?:ね)?|だ(?:ね)?|ね|になります(?:ね)?|とします(?:ね)?|(?:で|と|として)(?:見積もります|見積もりました|計算します|計算しました|反映します|反映しました|設定します|設定しました|扱います|受け取りました|承知しました)(?:ね)?|と見込んでいます|を目安にします)?[\s。、,!「」『』()（）]*$/u;
const EFFORT_VALUE_CONNECTOR = /^\s*(?:[、,]\s*)?(?:(?:は|で|に|が|を)\s*)?(?:[、,]\s*)?(?:(?:約|およそ|だいたい|大体)\s*)?$/u;
// Body-only suffixes. Mandatory ACKs still require the affirmative grammar.
// Match the entire suffix so a prior assertion ("ですね、…ですか?") stays checked.
const NON_AFFIRMATIVE_EFFORT_ENDING = /^\s*(?:[、,]\s*)?(?:(?:という(?:理解|認識))?(?:ですか|でしょうか|で(?:よい|いい)(?:ですか|でしょうか)|で合っていますか|でよろしいですか)[?？]|(?:[)）]\s*)?(?:として|で|を|は)?(?:計画に)?反映(?:されていません|していません)[。.!！]?)[\s」』)）]*$/u;

function planningRows(input: WeeklyPlanningStableV5DialogueRenderInput, key: string): Record<string, unknown>[] {
  return Array.isArray(input.planningInformation?.[key]) ? (input.planningInformation![key] as unknown[]).filter(isRecord) : [];
}

function effortDisplayScope(input: WeeklyPlanningStableV5DialogueRenderInput, taskId: unknown, targetFactId: unknown): Record<string, unknown> {
  const tasks = planningRows(input, 'tasks'), workloads = planningRows(input, 'workloads'), components = planningRows(input, 'components');
  const workload = workloads.find(row => row.id === targetFactId && row.taskId === taskId);
  const labels = [tasks.find(row => row.id === taskId)?.title];
  let componentId = workload?.componentId ?? components.find(row => row.id === targetFactId)?.id;
  const seen = new Set<unknown>();
  while (componentId && !seen.has(componentId)) {
    seen.add(componentId);
    const component = components.find(row => row.id === componentId && row.taskId === taskId);
    if (!component) break;
    labels.push(component.label); componentId = component.parentComponentId;
  }
  return { taskId, targetFactId, targetLabels: labels.filter((label): label is string => typeof label === 'string' && label.length > 0),
    unitLabel: workload?.unitLabel ?? null };
}

function activeEffortDisplayFacts(input: WeeklyPlanningStableV5DialogueRenderInput): WeeklyPlanningStableV5DialogueGroundingFact[] {
  const facts = planningRows(input, 'effortEstimates').flatMap<WeeklyPlanningStableV5DialogueGroundingFact>(fact => {
    if (typeof fact.id !== 'string' || typeof fact.taskId !== 'string' || typeof fact.targetFactId !== 'string') return [];
    return [{ factId: fact.id, kind: 'effort_estimate', sourceText: '', data: { ...fact, ...effortDisplayScope(input, fact.taskId, fact.targetFactId) } }];
  });
  // The active projection is authoritative; history never licenses reflection.
  return Array.isArray(input.planningInformation?.effortEstimates) ? facts
    : (input.currentTurnGrounding?.acceptedFacts ?? []).filter(fact => fact.kind === 'effort_estimate');
}

type EffortDisplayTuple = { kind: string; minutes: number; approximate: boolean; unitLabel: string | null;
  workloadContext: { amount: number; unitLabel: string } | null; span: { start: number; end: number } };

/** Recognize a bounded displayed tuple before comparing it to any expected value. */
function positiveEffortDisplayTuples(display: string, labelEnd: number, scope: Record<string, unknown>,
  input: WeeklyPlanningStableV5DialogueRenderInput): EffortDisplayTuple[] {
  const assertion = withoutNegatedEffortContrast(display, labelEnd, scope, input);
  const units = [...new Set([...planningRows(input, 'workloads').map(row => row.unitLabel),
    ...activeEffortDisplayFacts(input).map(fact => fact.data.unitLabel)].filter((unit): unit is string => typeof unit === 'string' && unit.length > 0)
    .map(normalizeSafetyText))].sort((a, b) => b.length - a.length);
  const markers = [{ pattern: /全部|合計|全体|総計|トータル/u, kind: 'total_duration', unitLabel: null as string | null },
    ...[...units.map(unit => ({ unit, kind: 'duration_per_unit' })), { unit: '回', kind: 'session_duration' }].map(({ unit, kind }) => {
      const literal = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { pattern: new RegExp(`(?:[1一]\\s*${literal}(?:あたり|当たり|につき)?|${literal}(?:あたり|当たり|につき))`, 'u'), kind, unitLabel: unit };
    }),
  ];
  const tuples: EffortDisplayTuple[] = [];
  for (const marker of markers) {
    const match = marker.pattern.exec(assertion.slice(labelEnd));
    if (!match) continue;
    const markerStart = labelEnd + match.index, markerEnd = markerStart + match[0].length;
    const prefix = assertion.slice(labelEnd, markerStart);
    let workloadContext: EffortDisplayTuple['workloadContext'] = null;
    if (!EFFORT_SUBJECT_CONNECTOR.test(prefix)) {
      const quantity = new RegExp(DISPLAY_NUMBER, 'u').exec(prefix);
      if (!quantity || !EFFORT_SUBJECT_CONNECTOR.test(prefix.slice(0, quantity.index))) continue;
      const afterQuantity = prefix.slice(quantity.index + quantity[0].length).trimStart();
      const unit = units.find(unit => afterQuantity.startsWith(unit) && EFFORT_SUBJECT_CONNECTOR.test(afterQuantity.slice(unit.length)));
      const amount = parseJapaneseInteger(quantity[0]);
      if (!unit || amount === null || amount <= 0) continue;
      workloadContext = { amount, unitLabel: unit };
    }
    for (const duration of assertion.slice(markerEnd).matchAll(DISPLAY_QUANTITY)) {
      if (!/時間|分/u.test(duration[0])) continue;
      const valueStart = markerEnd + duration.index!, valueEnd = valueStart + duration[0].length;
      if (!EFFORT_VALUE_CONNECTOR.test(assertion.slice(markerEnd, valueStart))) continue;
      const tail = assertion.slice(valueEnd);
      // Classify a direct clarification/denial before a comma can create an
      // empty affirmative ending. A following question cannot erase an assertion.
      if (NON_AFFIRMATIVE_EFFORT_ENDING.test(tail)) continue;
      // A closed parenthetical tuple is a factual premise even with following prose.
      // Otherwise retain the existing affirmative ending/short clause boundary.
      const parenthesis = /^(?:(?:くらい|ぐらい|ほど|前後|程度)\s*)?[)）]/u.exec(tail);
      const comma = tail.search(/[、,]/u);
      const ending = parenthesis ? parenthesis[0] : comma >= 0 ? tail.slice(0, comma) : tail;
      if (!AFFIRMATIVE_EFFORT_ENDING.test(ending)) continue;
      const values = displayQuantityMentions(assertion.slice(markerStart, valueEnd) + ending);
      const value = values?.find(value => value.form === 'duration');
      if (!value || values!.filter(value => value.form === 'duration').length !== 1) continue;
      tuples.push({ kind: marker.kind, minutes: value.minutes, approximate: value.approximate, unitLabel: marker.unitLabel, workloadContext, span: { start: markerStart, end: valueEnd } });
    }
  }
  return tuples;
}

function effortTupleMatchesFact(tuple: EffortDisplayTuple, scope: Record<string, unknown>, fact: Record<string, unknown>,
  input: WeeklyPlanningStableV5DialogueRenderInput): boolean {
  if (JSON.stringify([scope.taskId, scope.targetFactId, scope.targetLabels]) !== JSON.stringify([fact.taskId, fact.targetFactId, fact.targetLabels])
    || tuple.kind !== fact.kind || tuple.minutes !== fact.minutes || tuple.approximate !== (fact.precision === 'approximate')
    || (tuple.kind !== 'total_duration' && tuple.unitLabel !== (fact.kind === 'session_duration' ? '回' : normalizeSafetyText(String(fact.unitLabel))))) return false;
  if (!tuple.workloadContext) return true;
  const context = tuple.workloadContext;
  return planningRows(input, 'workloads').filter(workload => workload.taskId === scope.taskId
    && [workload.id, workload.componentId, workload.taskId].includes(scope.targetFactId)
    && workload.amount === context.amount && typeof workload.unitLabel === 'string' && normalizeSafetyText(workload.unitLabel) === context.unitLabel).length === 1;
}

function withoutNegatedEffortContrast(assertion: string, labelEnd: number, data: Record<string, unknown>,
  input: WeeklyPlanningStableV5DialogueRenderInput): string {
  const workloads = Array.isArray(input.planningInformation?.workloads) ? input.planningInformation!.workloads : [];
  const units = [...new Set([data.unitLabel, '回', ...workloads.filter(isRecord)
    .filter(workload => workload.taskId === data.taskId).map(workload => workload.unitLabel)]
    .filter((unit): unit is string => typeof unit === 'string' && unit.length > 0)
    .map(unit => normalizeSafetyText(unit).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))];
  const unit = `(?:${units.join('|')})`;
  const marker = `(?:(?:全部|合計|全体|総計|トータル)|(?:[1一]\\s*${unit}(?:あたり|当たり|につき)?|${unit}(?:あたり|当たり|につき)))`;
  const duration = `${DISPLAY_NUMBER}(?:時間(?:半|${DISPLAY_NUMBER}分)?|分)`;
  const contrast = new RegExp(`${marker}${EFFORT_VALUE_CONNECTOR.source.slice(1, -1)}${duration}(?:くらい|ぐらい|ほど|前後|程度)?\\s*(?:ではなく|じゃなく)(?:て)?\\s*[、,]?`, 'u')
    .exec(assertion.slice(labelEnd));
  if (!contrast || !EFFORT_SUBJECT_CONNECTOR.test(assertion.slice(labelEnd, labelEnd + contrast.index))) return assertion;
  const start = labelEnd + contrast.index; const end = start + contrast[0].length;
  if (!new RegExp(duration, 'u').test(assertion.slice(end))) return assertion;
  return assertion.slice(0, start) + ' '.repeat(end - start) + assertion.slice(end);
}

function effortAssertionVariants(assertion: string, labelEnd: number, data: Record<string, unknown>,
  input: WeeklyPlanningStableV5DialogueRenderInput): string[] {
  const workloads = input.planningInformation?.workloads;
  if (!Array.isArray(workloads) || typeof data.targetFactId !== 'string' || typeof data.taskId !== 'string') return [assertion];
  const taskTotal = data.kind === 'total_duration' && data.targetFactId === data.taskId;
  const quantity = new RegExp(DISPLAY_NUMBER, 'u').exec(assertion.slice(labelEnd));
  if (!quantity || !EFFORT_SUBJECT_CONNECTOR.test(assertion.slice(labelEnd, labelEnd + quantity.index))) return [assertion];
  const amount = parseJapaneseInteger(quantity[0]);
  const numberEnd = labelEnd + quantity.index + quantity[0].length;
  const unitStart = numberEnd + (/^\s*/u.exec(assertion.slice(numberEnd))?.[0].length ?? 0);
  const matches = workloads.flatMap(target => {
    if (!isRecord(target) || target.taskId !== data.taskId || (!taskTotal && target.id !== data.targetFactId)
      || typeof target.amount !== 'number' || !Number.isFinite(target.amount) || target.amount <= 0 || target.amount !== amount
      || typeof target.unitLabel !== 'string' || !target.unitLabel.length) return [];
    const unit = normalizeSafetyText(target.unitLabel);
    if (!assertion.startsWith(unit, unitStart)) return [];
    const quantityEnd = unitStart + unit.length;
    if (taskTotal) {
      const total = /全部|合計|全体|総計|トータル/u.exec(assertion.slice(quantityEnd));
      if (!total || !EFFORT_SUBJECT_CONNECTOR.test(assertion.slice(quantityEnd, quantityEnd + total.index))) return [];
    }
    return [quantityEnd];
  });
  if (matches.length !== 1) return [assertion];
  const quantityStart = labelEnd + quantity.index; const quantityEnd = matches[0];
  // Workload targets require their exact id. Task totals may name exactly one
  // matching same-task workload; rates cannot borrow this display context.
  // Keep the original variant so a one-unit target retains its rate denominator.
  return [assertion, assertion.slice(0, quantityStart) + ' '.repeat(quantityEnd - quantityStart) + assertion.slice(quantityEnd)];
}

/** Checks visible renderer claims against typed accepted effort; never interprets user intent. */
function effortAcknowledgementMismatch(factIds: readonly string[], text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput, mode: 'required_ack' | 'active_claims' = 'required_ack'): boolean {
  const required = mode === 'required_ack';
  const effort = required ? (input.currentTurnGrounding?.acceptedFacts ?? []).filter(f => f.kind === 'effort_estimate') : activeEffortDisplayFacts(input);
  if (required && !effort.length) return false;
  const scopes = required ? [] : [...effort.map(fact => fact.data),
    ...planningRows(input, 'tasks').map(task => effortDisplayScope(input, task.id, task.id)),
    ...['workloads', 'components'].flatMap(key => planningRows(input, key).map(row => effortDisplayScope(input, row.taskId, row.id)))];
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
  // Display-only aliases: exact literal prefixes at an existing の boundary.
  // Never infer a subject from user text or choose between shared task prefixes.
  const taskSubjects = new Map([...taskLabels].map(label => [label, label]));
  for (const title of taskLabels) {
    for (let at = title.indexOf('の'); at >= 0; at = title.indexOf('の', at + 1)) {
      const prefix = title.slice(0, at);
      const owners = [...taskLabels].filter(label => label === prefix || label.startsWith(`${prefix}の`));
      const duplicateTasks = planningRows(input, 'tasks').filter(task => typeof task.title === 'string'
        && normalizeSafetyText(task.title) === title).length > 1;
      if (prefix.length && owners.length === 1 && !duplicateTasks) taskSubjects.set(prefix, title);
    }
  }
  const components = Array.isArray(input.planningInformation?.components) ? input.planningInformation!.components.filter(isRecord) : [];
  const componentLabels = components.flatMap(component => typeof component.label === 'string' ? [normalizeSafetyText(component.label)] : []);
  const opaqueLabels = [...new Set([...taskSubjects.keys(), ...effort.flatMap(fact => Array.isArray(fact.data.targetLabels) ? fact.data.targetLabels : [])
    .filter((label): label is string => typeof label === 'string').map(normalizeSafetyText), ...(!required ? componentLabels : [])])].sort((a, b) => b.length - a.length);
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
    let anchors = spans.filter(span => span.start >= boundary.start && span.end <= boundary.end && taskSubjects.has(span.label));
    if (!required && !anchors.length) anchors = spans.filter(span => span.start >= boundary.start && span.end <= boundary.end && componentLabels.includes(span.label));
    return anchors.length ? anchors.map((anchor, i) => ({ label: anchor.label,
      text: visible.slice(i === 0 ? boundary.start : anchor.start, anchors[i + 1]?.start ?? boundary.end) }))
      : [{ label: null, text: visible.slice(boundary.start, boundary.end) }];
  });
  for (const { text: segment, label: targetLabel } of segments) {
    // Keep canonical scope labels for fact comparison, but consume the actual
    // displayed subject's length. Component/ancestor labels remain mandatory.
    const displayedTargetLabels = (labels: string[]): string[] | null => {
      const normalized = labels.map(normalizeSafetyText);
      if (targetLabel !== null && taskSubjects.get(targetLabel) === normalized[0]
        && normalized.slice(1).every(label => segment.includes(label))) return [targetLabel, ...normalized.slice(1)];
      if (!required && normalized[1] === targetLabel && componentLabels.filter(label => label === targetLabel).length === 1) {
        return normalized.filter(label => segment.includes(label));
      }
      return null;
    };
    let display = segment;
    for (const label of opaqueLabels) if (label.length) display = display.split(label).join(' '.repeat(label.length));
    display = display.replace(CLOCK_EXPRESSION, clock => ' '.repeat(clock.length));
    // Non-effort sentences may repeat typed dates/workloads. They cannot assign
    // an effort, and their bare numbers are not rate denominators or durations.
    if (!/[0-9０-９〇零一二三四五六七八九十百千万元億兆]\s*(?:時間|分)/u.test(display)) continue;
    if (!required) {
      const claims = scopes.flatMap(scope => {
        const labels = scope.targetLabels;
        if (!Array.isArray(labels) || !labels.length || !labels.every(label => typeof label === 'string')) return [];
        const displayedLabels = displayedTargetLabels(labels);
        if (!displayedLabels) return [];
        const labelEnd = Math.max(...displayedLabels.map(label => segment.lastIndexOf(label) + label.length));
        return positiveEffortDisplayTuples(display, labelEnd, scope, input).map(tuple => ({ scope, tuple }));
      });
      // Unrecognized prose abstains. A recognized tuple must have active proof;
      // changing only the expected value can never change whether it is recognized.
      const spans = new Set(claims.map(({ tuple }) => `${tuple.span.start}:${tuple.span.end}`));
      for (const span of spans) if (!claims.some(({ scope, tuple }) => `${tuple.span.start}:${tuple.span.end}` === span
        && effort.some(fact => effortTupleMatchesFact(tuple, scope, fact.data, input)))) return true;
      continue;
    }
    const matching = effort.filter(fact => {
      const data = fact.data; const labels = data.targetLabels;
      if ((required && (!factIds.includes(fact.factId) || assigned.has(fact.factId)))
        || !Array.isArray(labels) || !labels.length || !labels.every(label => typeof label === 'string')) return false;
      const displayedLabels = displayedTargetLabels(labels);
      if (!displayedLabels) return false;
      const labelEnd = Math.max(...displayedLabels.map(label => segment.lastIndexOf(label) + label.length));
      return effortAssertionVariants(display, labelEnd, data, input).some(assertion => {
        assertion = withoutNegatedEffortContrast(assertion, labelEnd, data, input);
        const mentions = displayQuantityMentions(assertion);
        if (!mentions) return false;
        const durations = mentions.filter(mention => mention.form !== 'bare');
        if (durations.length !== 1) return false;
        const duration = durations[0];
        if (duration.minutes !== data.minutes || (data.precision === 'approximate') !== duration.approximate
          || !AFFIRMATIVE_EFFORT_ENDING.test(assertion.slice(duration.span.end).trim())) return false;
        const totalMarker = /全部|合計|全体|総計|トータル/u.exec(assertion);
        const total = totalMarker !== null;
        const unit = data.kind === 'session_duration' ? '回' : data.unitLabel;
        let perUnit = false; let measurementStart = data.kind === 'total_duration' ? totalMarker?.index ?? -1 : -1;
        let measurementEnd = measurementStart >= 0 && totalMarker ? measurementStart + totalMarker[0].length : -1;
        if (typeof unit === 'string' && unit.length > 0) {
          const literal = normalizeSafetyText(unit);
          let at = assertion.indexOf(literal);
          while (at >= 0) {
            const denominator = mentions.find(m => m.form === 'bare' && m.span.end <= at
              && assertion.slice(m.span.end, at).trim() === '');
            const rateSuffix = /^(?:あたり|当たり|につき)/u.exec(assertion.slice(at + literal.length));
            if (denominator ? denominator.minutes === 1 : rateSuffix) {
              perUnit = true; measurementStart = denominator?.span.start ?? at;
              measurementEnd = at + literal.length + (rateSuffix?.[0].length ?? 0);
            }
            if (denominator && denominator.minutes !== 1 && (rateSuffix || data.kind !== 'total_duration')) return false;
            at = assertion.indexOf(literal, at + literal.length);
          }
        }
        if (data.kind === 'total_duration' ? !total || perUnit : !perUnit || total) return false;
        const subjectLink = assertion.slice(labelEnd, measurementStart);
        // Consume the entire marker→value interval with a short positive connector.
        // No arbitrary noun, substituted unit, extra number or predicate may hide here.
        const valueLink = assertion.slice(measurementEnd, duration.span.start);
        if (measurementEnd < 0 || measurementEnd > duration.span.start
          || !EFFORT_VALUE_CONNECTOR.test(valueLink)) return false;
        return measurementStart >= labelEnd && EFFORT_SUBJECT_CONNECTOR.test(subjectLink);
      });
    });
    if (matching.length !== 1) return true;
    assigned.add(matching[0].factId);
  }
  return required && effort.some(fact => !assigned.has(fact.factId));
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
    return value !== undefined && value !== null && (!isRecord(value)
      || (typeof value.text === 'string' && effortAcknowledgementMismatch([], value.text, input, 'active_claims')));
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
  // The mandatory ACK is strict; the remaining body uses the asymmetric active-fact check.

  return false;
}

function addsUngroundedDuration(text: string, input: WeeklyPlanningStableV5DialogueRenderInput): boolean {
  const values = (source: string) => {
    const display = normalizeSafetyText(source).replace(CLOCK_EXPRESSION, '');
    return (displayQuantityMentions(display) ?? []).filter(m => m.form !== 'bare'
      && !/^\s*(?:ではなく|じゃなく)/u.test(display.slice(m.span.end))).map(m => m.minutes);
  };
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
  if (effortAcknowledgementMismatch([], text, input, 'active_claims')) return 'grounding_contract_mismatch';

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
    input.communication?.eventRegistration,
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

/** Historical text-interpretation oracle, retained for non-production regression study.
 * It is NOT an acceptance/safety gate: Japanese prose cannot be exhaustively
 * verified with a bounded set of textual expressions.
 */
export function evaluateWeeklyPlanningLegacyDialogueTextGuard(
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

/**
 * Live renderer boundary: validates the transport and application-owned action,
 * not the semantic truth of free-form Japanese prose. The renderer cannot create
 * facts, schedules, approvals or saves. Those are guarded by typed application
 * decisions; a text guard would be both incomplete and prone to false rejection.
 *
 * The legacy language oracle above is intentionally not invoked here.
 */
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
  if (!isRecord(parsed)
    || typeof parsed.actionId !== 'string'
    || typeof parsed.actionKind !== 'string'
    || (parsed.questionCode !== null && typeof parsed.questionCode !== 'string')
    || typeof parsed.text !== 'string') {
    return { status: 'fallback', reason: 'invalid_shape', rawResponse };
  }
  if (parsed.actionId !== input.actionId) {
    return { status: 'fallback', reason: 'action_mismatch', rawResponse };
  }
  if (parsed.actionKind !== input.actionKind || parsed.questionCode !== input.questionCode) {
    return { status: 'fallback', reason: 'action_contract_mismatch', rawResponse };
  }
  const text = parsed.text.replace(/\r\n/g, '\n').trim();
  // Only finite, syntactic safety checks. All measurements, entities, dates,
  // quantity precision, target identity and planning permissions belong to the
  // authoritative typed graph or to offline model-quality evaluation.
  if (!text.length || text.length > MAX_RENDERED_TEXT_LENGTH
    || containsExternalDestination(text) || containsSensitiveValue(text)
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(text)) {
    return { status: 'fallback', reason: 'unsafe_text', rawResponse };
  }
  // A small high-impact guard remains: falsely announcing that approval or
  // persistence already happened. It is a user-facing safety backstop, never
  // authorization or a complete semantic validator.
  if (repeatsMostRecentAssistantQuestion(text, input)) {
    return { status: 'fallback', reason: 'repeated_question_text', rawResponse };
  }
  if (claimsUnexecutedAction(text, input)) {
    return { status: 'fallback', reason: 'ungrounded_text', rawResponse };
  }
  return { status: 'rendered', text, rawResponse };
}
