import { evaluatedWeeklyPlanningConsultationDates } from '../application/weeklyPlanningConsultationCommunication';
import {
  groundedDateExpressionsFromPlanningInformation,
} from './weeklyPlanningDialogueDateGrounding';
import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import { WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL } from './weeklyPlanningStableV5DialogueContext';
import { claimsUnverifiedWeeklyPlanningPreviewConstraints, hasUnverifiedWeeklyPlanningPreviewConstraints } from './weeklyPlanningPreviewConstraintClaims';
import type {
  WeeklyPlanningStableV5DialogueFallbackReason,
  WeeklyPlanningStableV5DialogueRenderInput,
  WeeklyPlanningStableV5DialogueRenderResult,
} from './weeklyPlanningStableV5DialogueContracts';

const MAX_RENDERED_TEXT_LENGTH = 800;
const EXTERNAL_DESTINATION = /https?:\/\/|www\.|(?<![a-z0-9.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?![a-z0-9.-])/i;
// These are the application's own mutation outcomes, not a vocabulary of
// attacker phrases. A renderer question/status/preview cannot perform them.
const APPLICATION_MUTATION_OUTCOME = /(?:保存|作成|登録|追加|削除|承認|反映|確定|適用|スケジュール)(?:を|が|は|も)?(?:しました|されました|いたしました|しています|できました|完了(?:しました|しています)?|済み(?:です|でした)?)/;
const SENSITIVE_VALUE = /(?:パスワード|暗証番号|秘密情報|APIキー|アクセストークン|口座番号|クレジットカード)/i;
const CLOCK_EXPRESSION = /(?:[01]?\d|2[0-3])[:：][0-5]\d|(?:午前|午後)?\s*(?:[01]?\d|2[0-3])\s*時(?:\s*(?:[0-5]?\d\s*分|半))?/g;
const DATE_EXPRESSION = /(?:今日|明日|明後日|今週|来週|週末)|\d{1,2}\s*月\s*\d{1,2}\s*日/g;
const PREVIEW_COUNT_EXPRESSION = /(\d+)\s*件/g;
// Interaction architecture: the renderer's own claim that candidates were made or changed.
// Only checked on replies that come with no new preview; naming the existing preview is fine.
const NEW_CANDIDATES_CLAIM = /(?:候補|仮予定|案)(?:を|が|は|も)?[^。！？!?\n]{0,12}?(?:できました|作りました|作成しました|用意しました|出しました|分けました|変えました|直しました|組みました)/u;
const APPLIED_PLACEMENT_CLAIM = /(?:希望(?:どおり|通り)に(?:調整|変更|分割)しました|(?:朝|昼|夜|午前|午後|夕方)に(?:分けました|まとめました|組みました|配置しました))/u;
// An unchanged-preview claim requires that exact application-owned status. A
// clarification or recovery must not present a stale/rejected correction as final.
const UNCHANGED_CANDIDATES_CLAIM = /(?:候補|仮予定|案)(?:を|が|は|も)?[^。！？!?\n]{0,12}?(?:そのままです|変わりません|変わっていません|変更していません|変更はありません)/u;
const EXECUTION_VERB = '(?:作ります|作成します|追加します|登録します|保存します|組みます|反映します|入れます|入れました|入れておきます)';
const EXECUTION_CLAIM_EXPRESSION = new RegExp(
  `(?:(?:予定|仮予定|計画).{0,20}${EXECUTION_VERB}|${EXECUTION_VERB}.{0,20}(?:予定|仮予定|計画))`,
);
// Interaction architecture: vocabulary of the app's own internals (data processing, states,
// providers, retries, "not applied" reports, machine codes). It never belongs in an ordinary
// reply. Deliberately narrow: unmistakable implementation words and report forms only, and a
// word the user said or a plan label contains is allowed. This checks the renderer's own
// output; it never interprets the user's words.
const INTERNAL_PROCESS_TERMS = new RegExp([
  '構造化|正規化|バリデーション|スキーマ|プロバイダ|リトライ|再試行|内部処理|システム|処理結果',
  '処理(?:でき|に失敗|され(?:ませ|なかっ))|予定条件|安全に(?:整理|配置|処理|反映|保存)|ペンディング|ステート',
  'リビジョン|ファクト|確認中の質問|保留|検証|パース|フォールバック|エラーコード',
  '反映して(?:い)?ません|反映されて(?:い)?ません|反映でき(?:ません|なかっ)|取り込(?:めて(?:い)?ませ|まれて(?:い)?ませ|めませ|めなかっ)',
  // ASCII words are matched between non-letters, so snake_case neighbours do not hide them.
  '(?<![A-Za-z0-9])(?:validation|validator|pending|provider|retry|schema|json|state|revision|graph|authoritative|canonical|semantic|normaliz[a-z]*|fallback|parse[dr]?|payload|diagnostics?)(?![A-Za-z0-9])',
  // Any snake_case identifier (question, goal and failure codes) is a machine code.
  '(?<![A-Za-z0-9_])[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+(?![A-Za-z0-9_])',
].join('|'), 'giu');

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

function safetyNarrative(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): string {
  const normalized = normalizeSafetyText(text);
  const withoutQuotes = withoutGroundedQuotedData(normalized, input);
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
  const colon = /^(\d{1,2}):(\d{2})$/.exec(compact);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
      ? hour * 60 + minute
      : null;
  }

  const japanese = /^(午前|午後)?(\d{1,2})時(?:(\d{1,2})分|半)?$/.exec(compact);
  if (!japanese) return null;
  let hour = Number(japanese[2]);
  const minute = japanese[3] !== undefined
    ? Number(japanese[3])
    : compact.endsWith('半')
      ? 30
      : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  if (japanese[1] === '午前' && hour === 12) hour = 0;
  if (japanese[1] === '午後' && hour < 12) hour += 12;
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

/**
 * The application states omitted work itself, next to the reply. The reply must not name work
 * that was entirely left out of the preview, so it can never claim that work is included; work
 * only partly left out still has candidates and may be named. A longer label that merely
 * contains the omitted one (another task) does not count as naming it.
 */
function mentionsFullyOmittedWork(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  const disclosure = input.communication?.previewDisclosure;
  if (!disclosure) return false;
  const labels = groundedDisplayLabels(input);
  return disclosure.omittedWork
    .filter((work) => work.extent === 'all' && work.label.trim().length > 0)
    .some((work) => {
      const label = work.label.trim();
      const remaining = labels
        .filter((other) => other !== label && other.includes(label))
        .sort((a, b) => b.length - a.length)
        .reduce((current, other) => current.split(other).join(''), text);
      return remaining.includes(label);
    });
}

/**
 * The app-internal words a text contains. One list for every check of what the user sees: the
 * renderer's output here, and the fixed emergency wording in the prose contract test.
 */
export function weeklyPlanningInternalProcessTermsIn(text: string): string[] {
  return [...normalizeSafetyText(text).matchAll(INTERNAL_PROCESS_TERMS)].map((match) => match[0]);
}

function exposesInternalProcess(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  if (!input.communication) return false;
  // Only what the user wrote and the plan's display labels can legitimise a word; machine
  // keys and enum values of the planning data never do (e.g. a `revision` field).
  const grounding = [
    input.currentUserMessage,
    ...input.recentConversation.filter((turn) => turn.role === 'user').map((turn) => turn.content),
    ...groundedDisplayLabels(input),
  ].map((value) => normalizeSafetyText(value).toLowerCase());
  return weeklyPlanningInternalProcessTermsIn(text)
    .some((term) => !grounding.some((value) => value.includes(term.toLowerCase())));
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
  const rawNarrative = safetyNarrative(text, input);
  // Candidate creation is evidenced by this turn's preview, unlike creating a
  // saved plan. Match only the direct candidate object, never arbitrary words
  // between it and the predicate; later mutations in the same sentence stay checked.
  const narrative = conversationArchitecturePolicy(input.conversationArchitecture).interactionOutcome
    && input.actionKind === 'preview_ready' && input.previewCount >= 1
    ? rawNarrative.replace(/(^|[。！？!?\n])(\s*候補(?:\s*\d+\s*件(?:を)?|を(?:\s*\d+\s*件)?)?\s*)作成しました/gu, '$1$2〈候補提示〉')
    : rawNarrative;
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

  const neutralAcknowledgement = conversationArchitecturePolicy(input.conversationArchitecture).interactionOutcome
    && hasUnverifiedWeeklyPlanningPreviewConstraints(input.communication?.previewConstraintSatisfaction);
  if (!neutralAcknowledgement && missesAcknowledgedClockValue({
    factIds: factIds as string[],
    acknowledgementText,
    input,
  })) {
    return true;
  }

  return !normalizeDialogueText(text).startsWith(
    normalizeDialogueText(acknowledgementText),
  );
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

  if (missesPreviewPromotionControl(text, input) || mentionsFullyOmittedWork(text, input)) {
    return 'action_contract_mismatch';
  }
  if (claimsUnverifiedWeeklyPlanningPreviewConstraints(text, input.communication?.previewConstraintSatisfaction)) {
    return conversationArchitecturePolicy(input.conversationArchitecture).interactionOutcome
      ? 'unverified_preview_constraint_claim' : 'action_contract_mismatch';
  }

  // The question is bound to this reply as presented: a reply that must ask it has to contain a
  // question (a structural check on the renderer's own text, not an interpretation of it).
  if (input.communication?.askQuestion === true && !/[?？]/u.test(text)) {
    return 'missing_question';
  }

  // No new preview in this reply (status, question, …): it may not claim new or changed
  // candidates, e.g. "both evening" when the preview stayed as it was.
  if (input.communication && input.actionKind !== 'preview_ready'
    && (NEW_CANDIDATES_CLAIM.test(text) || APPLIED_PLACEMENT_CLAIM.test(text))) {
    return 'preview_claim_without_preview';
  }
  if (input.communication && input.communication.statusReason !== 'preview_unchanged'
    && UNCHANGED_CANDIDATES_CLAIM.test(text)) {
    return 'preview_claim_without_preview';
  }
  // A message the application could not use changed nothing; its reply may not invite promoting
  // the previous preview as if it answered that message (review of fa6347e6).
  if (input.communication?.goal === 'clarify_turn'
    && text.includes(WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL)) {
    return 'preview_claim_without_preview';
  }

  if (repeatsMostRecentAssistantQuestion(text, input)) {
    return 'repeated_question_text';
  }

  const groundingInformation = JSON.stringify({
    currentUserMessage: input.currentUserMessage,
    recentConversation: input.recentConversation,
    planningInformation: input.planningInformation,
    requiredLabels: input.requiredLabels,
    previewPromotionControlLabel: input.previewPromotionControlLabel ?? null,
    previewCount: input.previewCount,
  });
  const groundedDateExpressions = groundedDateExpressionsFromPlanningInformation(
    input.planningInformation,
  );
  if (conversationArchitecturePolicy(input.conversationArchitecture).interactionOutcome) {
    groundedDateExpressions.push(...groundedDateExpressionsFromPlanningInformation({
      planningWindows: evaluatedWeeklyPlanningConsultationDates(input.communication?.consultation).map(value => ({ value })),
    }));
  }
  if (
    addsUnsupportedExpression(text, groundingInformation, CLOCK_EXPRESSION)
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

  if (exposesInternalProcess(text, input)) {
    return 'internal_process_text';
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

  const consultation = conversationArchitecturePolicy(input.conversationArchitecture).interactionOutcome
    ? input.communication?.consultation : undefined;
  if (consultation && (
    !['none', 'fits', 'does_not_fit'].includes(String(parsed.feasibilityClaim))
    || (parsed.feasibilityClaim !== 'none' && parsed.feasibilityClaim !== consultation.feasibility.status)
  )) {
    return { status: 'fallback', reason: 'unchecked_consultation_feasibility', rawResponse };
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
