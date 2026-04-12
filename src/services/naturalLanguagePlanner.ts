import { minutesFromTime, timeFromMinutes } from '../lib/date';
import { getAiConfig, getAiProviderLabel, type AiConfig } from '../lib/aiConfig';
import { buildDefaultPlanTitle } from '../lib/plans';
import type {
  NaturalLanguageSuggestion,
  Plan,
  PlanDraft,
  PlanType,
  SuggestionField,
} from '../types/domain';
import type { JsonSchemaResponseFormat } from './ai/openAiCompatibleClient';
import { createOpenAiCompatibleClient } from './ai/openAiCompatibleClient';
import {
  defaultDraft,
  detectSubject,
  detectType,
  extractMemoHint,
  hasExplicitClockTime,
  matchPlan,
  parseDate,
  parseDurationMinutes,
  parseTimes,
  sanitizeSuggestedTitle,
  splitAddTaskTexts,
  type SuggestionInput,
} from './naturalLanguageRules';

interface PlannerExtraction {
  matchedPlanId?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  subject?: string | null;
  type?: PlanType | null;
  title?: string | null;
  memo?: string | null;
  confidence?: number | null;
  reason?: string | null;
  assumptions?: string[] | null;
  unresolvedFields?: string[] | null;
}

interface BatchPlannerExtraction extends PlannerExtraction {
  rawText?: string | null;
}

interface BatchPlannerExtractionResponse {
  tasks: BatchPlannerExtraction[];
}

interface TimeResolutionResult {
  startTime: string;
  endTime: string;
  assumptions: string[];
  unresolvedFields: SuggestionField[];
}

export interface PlannerAiRuntimeInfo {
  providerLabel: string;
  fallbackLabel: string;
}

type ValidationPolicy = 'strict' | 'relaxed';

const ALLOWED_PLAN_TYPES: PlanType[] = [
  'study',
  'mock-exam',
  'school-event',
  'cram-school',
  'deadline',
  'other',
];

const ALLOWED_SUGGESTION_FIELDS: SuggestionField[] = [
  'targetPlan',
  'date',
  'startTime',
  'endTime',
  'subject',
  'type',
  'title',
  'memo',
];

const EXTRACTION_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'planner_extraction',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'matchedPlanId',
        'date',
        'startTime',
        'endTime',
        'subject',
        'type',
        'title',
        'memo',
        'confidence',
        'reason',
        'assumptions',
        'unresolvedFields',
      ],
      properties: {
        matchedPlanId: { type: ['string', 'null'] },
        date: { type: ['string', 'null'] },
        startTime: { type: ['string', 'null'] },
        endTime: { type: ['string', 'null'] },
        subject: { type: ['string', 'null'] },
        type: {
          type: ['string', 'null'],
          enum: [
            'study',
            'mock-exam',
            'school-event',
            'cram-school',
            'deadline',
            'other',
            null,
          ],
        },
        title: { type: ['string', 'null'] },
        memo: { type: ['string', 'null'] },
        confidence: { type: ['number', 'null'] },
        reason: { type: ['string', 'null'] },
        assumptions: {
          type: 'array',
          items: { type: 'string' },
        },
        unresolvedFields: {
          type: 'array',
          items: {
            type: 'string',
            enum: ALLOWED_SUGGESTION_FIELDS,
          },
        },
      },
    },
  },
};

const BATCH_EXTRACTION_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'planner_batch_extraction',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tasks'],
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'rawText',
              'date',
              'startTime',
              'endTime',
              'subject',
              'type',
              'title',
              'memo',
              'confidence',
              'reason',
              'assumptions',
              'unresolvedFields',
            ],
            properties: {
              rawText: { type: ['string', 'null'] },
              date: { type: ['string', 'null'] },
              startTime: { type: ['string', 'null'] },
              endTime: { type: ['string', 'null'] },
              subject: { type: ['string', 'null'] },
              type: {
                type: ['string', 'null'],
                enum: [
                  'study',
                  'mock-exam',
                  'school-event',
                  'cram-school',
                  'deadline',
                  'other',
                  null,
                ],
              },
              title: { type: ['string', 'null'] },
              memo: { type: ['string', 'null'] },
              confidence: { type: ['number', 'null'] },
              reason: { type: ['string', 'null'] },
              assumptions: {
                type: 'array',
                items: { type: 'string' },
              },
              unresolvedFields: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ALLOWED_SUGGESTION_FIELDS,
                },
              },
            },
          },
        },
      },
    },
  },
};

function normalizeParsingText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[：]/g, ':')
    .replace(/[／]/g, '/')
    .replace(/[〜～]/g, '~')
    .replace(/[　]/g, ' ');
}

function normalizeDate(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function normalizeTime(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return /^\d{2}:\d{2}$/.test(value) ? value : undefined;
}

function normalizeType(value: string | null | undefined): PlanType | undefined {
  if (!value) {
    return undefined;
  }

  return ALLOWED_PLAN_TYPES.find((type) => type === value) ?? undefined;
}

function clampConfidence(value: number | null | undefined, fallback = 0.72): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeComparableText(value: string): string {
  return normalizeParsingText(value)
    .replace(/\s+/g, '')
    .replace(/[「」"'、。,.:：~\-]/g, '')
    .replace(/問題番号は/g, '問題番号')
    .replace(/第(\d+)/g, '$1');
}

function isGroundedInSources(
  candidate: string | undefined,
  ...sources: Array<string | undefined>
): boolean {
  const normalizedCandidate = normalizeComparableText(candidate ?? '');

  if (!normalizedCandidate) {
    return false;
  }

  return sources.some((source) => {
    const normalizedSource = normalizeComparableText(source ?? '');
    return (
      Boolean(normalizedSource) &&
      (normalizedSource.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedSource))
    );
  });
}

function getValidationPolicy(config: AiConfig): ValidationPolicy {
  return config.provider === 'openai' ? 'relaxed' : 'strict';
}

function extractFirstJsonObject(content: string): string | null {
  const fencedMatch =
    content.match(/```json\s*([\s\S]*?)```/i) ??
    content.match(/```\s*([\s\S]*?)```/i);
  const source = fencedMatch?.[1]?.trim() || content.trim();
  let depth = 0;
  let startIndex = -1;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === '{') {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
    } else if (char === '}') {
      depth -= 1;

      if (depth === 0 && startIndex >= 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function formatPlansForPrompt(plans: Plan[], selectedDate: string): string {
  const nearbyPlans = plans
    .filter((plan) => {
      const deltaDays =
        Math.abs(
          new Date(`${plan.date}T00:00:00`).getTime() -
            new Date(`${selectedDate}T00:00:00`).getTime(),
        ) /
        (1000 * 60 * 60 * 24);

      return deltaDays <= 14;
    })
    .slice(0, 16);

  if (nearbyPlans.length === 0) {
    return 'none';
  }

  return nearbyPlans
    .map(
      (plan) =>
        `${plan.id} | ${plan.date} | ${plan.startTime}-${plan.endTime} | ${plan.title} | ${plan.subject || '-'} | ${plan.type}`,
    )
    .join('\n');
}

function normalizeTaskTexts(taskTexts: string[], fallbackText: string): string[] {
  const normalizedTasks = taskTexts
    .map((taskText) => normalizeParsingText(taskText).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((taskText, index, array) => array.indexOf(taskText) === index);

  return normalizedTasks.length > 0 ? normalizedTasks : [fallbackText.trim()];
}

function normalizeBatchExtractionTasks(
  tasks: BatchPlannerExtraction[] | null | undefined,
  fallbackText: string,
): BatchPlannerExtraction[] {
  const normalizedTasks = (tasks ?? [])
    .map((task) => ({
      ...task,
      rawText: normalizeText(task.rawText) ?? fallbackText.trim(),
    }))
    .filter(
      (task, index, array) =>
        array.findIndex(
          (candidate) =>
            candidate.rawText === task.rawText &&
            normalizeDate(candidate.date) === normalizeDate(task.date) &&
            normalizeTime(candidate.startTime) === normalizeTime(task.startTime),
        ) === index,
    );

  return normalizedTasks.length > 0
    ? normalizedTasks
    : [{ rawText: fallbackText.trim() }];
}

function sanitizeAssumptionText(value: string): string {
  return value
    .replace(/selectedDate/g, '選択中の日付')
    .replace(/\s+/g, ' ')
    .trim();
}

async function requestBatchPlannerExtraction(
  input: SuggestionInput,
): Promise<BatchPlannerExtraction[]> {
  const config = getAiConfig();

  if (config.provider === 'rules') {
    throw new Error('AI provider is disabled.');
  }

  const client = createOpenAiCompatibleClient(config);
  const systemPrompt = [
    'あなたは日本語の勉強計画アシスタントです。',
    '1つの入力文全体を読み、含まれる複数の予定を順番どおりに抽出してください。',
    '必ず tasks 配列で返してください。1件なら1件だけ入れてください。',
    '「そのあと」「その後」「続けて」「昼食後」などの相対表現は、前後関係から解釈してください。',
    '開始時刻が省略されていても、直前の予定の終了直後だと明らかな場合は startTime と endTime を補ってください。',
    '開始時刻と学習時間があれば endTime を計算してください。',
    'タイトルに日付、時刻、接続表現、時間帯、説明語を入れないでください。',
    '教材名や学習内容だけを短く title に入れてください。',
    '章、問題番号、補足情報は memo に入れてください。',
    '入力文に無い内容を作らないでください。',
    '5分を超えて重なる予定は作らないでください。もし確定できなければ unresolvedFields に必要項目を入れてください。',
    'assumptions はユーザー向けの短い日本語だけにしてください。internal variable 名は出さないでください。',
    'JSON以外は返さないでください。',
  ].join('\n');
  const userPrompt = [
    `selectedDate: ${input.selectedDate}`,
    `userText: ${input.text}`,
  ].join('\n');
  const rawContent = await client.createChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0,
    responseFormat: BATCH_EXTRACTION_RESPONSE_FORMAT,
  });
  const jsonText = extractFirstJsonObject(rawContent);

  if (!jsonText) {
    throw new Error('Batch extraction response did not include JSON.');
  }

  const parsedResponse = JSON.parse(jsonText) as BatchPlannerExtractionResponse;
  return normalizeBatchExtractionTasks(parsedResponse.tasks, input.text);
}

async function buildBatchedAddSuggestions(
  input: SuggestionInput,
): Promise<NaturalLanguageSuggestion[]> {
  const validationPolicy = getValidationPolicy(getAiConfig());
  const extractions = await requestBatchPlannerExtraction(input);

  return extractions.map((extraction) => {
    const taskInput: SuggestionInput = {
      ...input,
      text: normalizeText(extraction.rawText) ?? input.text,
    };
    const baseline = buildDeterministicSuggestion(taskInput);
    const issues = collectModelIssues(
      taskInput,
      baseline,
      extraction,
      validationPolicy,
    );
    const suggestion = buildLlmSuggestion(
      taskInput,
      baseline,
      extraction,
      issues,
      validationPolicy,
    );

    return {
      ...suggestion,
      rawText: taskInput.text,
      assumptions: suggestion.assumptions.map(sanitizeAssumptionText),
    };
  });
}

function hasExplicitDateExpression(text: string): boolean {
  const normalizedText = normalizeParsingText(text);
  return /明後日|明日|今日|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日/.test(
    normalizedText,
  );
}

function mergeDistinctText(...values: Array<string | undefined>): string {
  const uniqueValues = values.filter(
    (value, index, array): value is string =>
      Boolean(value) && array.indexOf(value) === index,
  );
  return uniqueValues.join(' / ');
}

function mergeSuggestionFields(
  ...fieldGroups: SuggestionField[][]
): SuggestionField[] {
  return fieldGroups
    .flat()
    .filter(
      (field, index, array) =>
        ALLOWED_SUGGESTION_FIELDS.includes(field) && array.indexOf(field) === index,
    );
}

function normalizeFieldName(value: string): SuggestionField | undefined {
  const normalizedValue = value.trim();

  if (
    normalizedValue === 'matchedPlanId' ||
    normalizedValue === 'targetPlanId' ||
    normalizedValue === 'planId'
  ) {
    return 'targetPlan';
  }

  return ALLOWED_SUGGESTION_FIELDS.find((field) => field === normalizedValue);
}

function normalizeFieldList(
  values: string[] | null | undefined,
): SuggestionField[] {
  return (values ?? [])
    .map((value) => normalizeFieldName(value))
    .filter((value): value is SuggestionField => Boolean(value));
}

function hasRelativeOrderCue(text: string): boolean {
  return /そのあと|その後|続けて|次に/.test(normalizeParsingText(text));
}

function sanitizeDisplayTitle(title: string, date: string): string {
  return title
    .replace(new RegExp(date.replace(/-/g, '[-/]'), 'g'), ' ')
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, ' ')
    .replace(/^\s*(?:今日|明日|明後日)\s*/g, '')
    .replace(/^\s*(?:朝|朝の|午前|午後|夜|夕方)\s*/g, '')
    .replace(/^\s*(?:そのあと|その後|続けて|次に)\s*/g, '')
    .replace(/^\s*(?:おひるごはん食べた後に|お昼ごはん食べた後に|昼ごはん食べた後に|昼食後に?)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateOverlapMinutes(
  startTimeA: string,
  endTimeA: string,
  startTimeB: string,
  endTimeB: string,
): number {
  const overlapStart = Math.max(
    minutesFromTime(startTimeA),
    minutesFromTime(startTimeB),
  );
  const overlapEnd = Math.min(
    minutesFromTime(endTimeA),
    minutesFromTime(endTimeB),
  );

  return Math.max(0, overlapEnd - overlapStart);
}

function finalizeSuggestionStatus(
  suggestion: NaturalLanguageSuggestion,
): NaturalLanguageSuggestion {
  const nextStatus =
    suggestion.unresolvedFields.length > 0
      ? 'needs_review'
      : suggestion.issues.length > 0
        ? 'needs_review'
        : 'ready';

  return {
    ...suggestion,
    status: suggestion.status === 'failed' ? 'failed' : nextStatus,
  };
}

function postProcessAddSuggestions(
  suggestions: NaturalLanguageSuggestion[],
): NaturalLanguageSuggestion[] {
  const processedSuggestions: NaturalLanguageSuggestion[] = [];

  suggestions.forEach((suggestion) => {
    const previousSuggestion =
      processedSuggestions[processedSuggestions.length - 1];
    const nextSuggestion: NaturalLanguageSuggestion = {
      ...suggestion,
      parsedPlan: {
        ...suggestion.parsedPlan,
      },
      assumptions: [...suggestion.assumptions],
      unresolvedFields: [...suggestion.unresolvedFields],
      issues: suggestion.issues.filter(
        (issue) =>
          issue !== 'start_time_conflicts_with_input' &&
          issue !== 'end_time_conflicts_with_input' &&
          issue !== 'time_reversed',
      ),
    };
    const explicitStart = hasExplicitClockTime(nextSuggestion.rawText);
    const durationMinutes = parseDurationMinutes(nextSuggestion.rawText);
    const rawTitle = sanitizeDisplayTitle(
      nextSuggestion.parsedPlan.title,
      nextSuggestion.parsedPlan.date,
    );
    const resolvedTitle =
      nextSuggestion.source === 'llm'
        ? rawTitle || nextSuggestion.parsedPlan.title
        : rawTitle || 
          deriveDeterministicTitle(
            nextSuggestion.rawText,
            nextSuggestion.parsedPlan.subject,
            nextSuggestion.parsedPlan.type,
            rawTitle,
          );

    if (resolvedTitle) {
      nextSuggestion.parsedPlan.title = resolvedTitle;
    }

    const normalizedLabels = normalizeStudyLabels({
      rawText: nextSuggestion.rawText,
      subject: nextSuggestion.parsedPlan.subject,
      title: nextSuggestion.parsedPlan.title,
      type: nextSuggestion.parsedPlan.type,
      fallbackTitle: nextSuggestion.parsedPlan.title,
    });

    nextSuggestion.parsedPlan.subject = normalizedLabels.subject;
    nextSuggestion.parsedPlan.title = normalizedLabels.title;

    if (
      !explicitStart &&
      durationMinutes !== undefined &&
      hasRelativeOrderCue(nextSuggestion.rawText) &&
      previousSuggestion?.parsedPlan.endTime
    ) {
      nextSuggestion.parsedPlan.startTime = previousSuggestion.parsedPlan.endTime;
      nextSuggestion.parsedPlan.endTime = timeFromMinutes(
        minutesFromTime(previousSuggestion.parsedPlan.endTime) + durationMinutes,
      );
      nextSuggestion.assumptions = Array.from(
        new Set([
          ...nextSuggestion.assumptions,
          '前の予定の終了時刻から開始時刻を補いました。',
        ]),
      );
      nextSuggestion.unresolvedFields = nextSuggestion.unresolvedFields.filter(
        (field) => field !== 'startTime' && field !== 'endTime',
      );
    }

    if (
      explicitStart &&
      durationMinutes !== undefined &&
      nextSuggestion.parsedPlan.startTime
    ) {
      nextSuggestion.parsedPlan.endTime = timeFromMinutes(
        minutesFromTime(nextSuggestion.parsedPlan.startTime) + durationMinutes,
      );
      nextSuggestion.unresolvedFields = nextSuggestion.unresolvedFields.filter(
        (field) => field !== 'endTime',
      );
    }

    if (
      previousSuggestion &&
      previousSuggestion.parsedPlan.date === nextSuggestion.parsedPlan.date &&
      previousSuggestion.parsedPlan.startTime &&
      previousSuggestion.parsedPlan.endTime &&
      nextSuggestion.parsedPlan.startTime &&
      nextSuggestion.parsedPlan.endTime
    ) {
      const overlapMinutes = calculateOverlapMinutes(
        previousSuggestion.parsedPlan.startTime,
        previousSuggestion.parsedPlan.endTime,
        nextSuggestion.parsedPlan.startTime,
        nextSuggestion.parsedPlan.endTime,
      );

      if (overlapMinutes > 5) {
        nextSuggestion.status = 'failed';
        nextSuggestion.issues = Array.from(
          new Set([...nextSuggestion.issues, 'time_overlap_conflict']),
        );
        nextSuggestion.assumptions = Array.from(
          new Set([
            ...nextSuggestion.assumptions,
            '前の予定と5分以上重なるため、自動反映しないようにしました。',
          ]),
        );
      }
    }

    processedSuggestions.push(finalizeSuggestionStatus(nextSuggestion));
  });

  return processedSuggestions;
}

function buildBaseDraft(
  userId: string,
  selectedDate: string,
  matchedPlan?: Plan,
): PlanDraft {
  if (!matchedPlan) {
    return defaultDraft(userId, selectedDate);
  }

  return {
    userId,
    title: matchedPlan.title,
    subject: matchedPlan.subject,
    date: matchedPlan.date,
    startTime: matchedPlan.startTime,
    endTime: matchedPlan.endTime,
    type: matchedPlan.type,
    memo: matchedPlan.memo,
    repeat: matchedPlan.repeat,
    repeatUntil: matchedPlan.repeatUntil,
    excludedDates: matchedPlan.excludedDates,
  };
}

function trimContentPhrase(value: string): string {
  return value
    .replace(/^(今日|明日|明後日)(?:の)?/g, '')
    .replace(/^(?:その日|この日|当日)(?:の)?/g, '')
    .replace(/(?:を)?(?:やる|する|進める|復習|演習|学習|勉強|予定)$/g, '')
    .replace(/^(?:に|で|を|は|が|の|へ)+/g, '')
    .replace(/(?:に|で|を|は|が|の|へ)+$/g, '')
    .replace(/^(?:ちょっと|少し|ちょい)+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLeadingSubjectFromTitle(title: string, subject: string): string {
  const normalizedTitle = trimContentPhrase(title);
  const normalizedSubject = subject.trim();

  if (!normalizedTitle || !normalizedSubject) {
    return normalizedTitle;
  }

  const strippedTitle = normalizedTitle.replace(
    new RegExp(
      `^${escapeRegExp(normalizedSubject)}(?:の|を|で|は|:|：|/|／|\\s+)`,
      'i',
    ),
    '',
  );

  return trimContentPhrase(strippedTitle);
}

function normalizeStudyLabels(params: {
  rawText: string;
  subject: string;
  title: string;
  type: PlanType;
  fallbackTitle?: string;
}): { subject: string; title: string } {
  const normalizedSubject =
    detectSubject(
      [params.subject, params.title, params.rawText].filter(Boolean).join(' '),
    ) || params.subject.trim();
  let normalizedTitle = trimContentPhrase(params.title);

  if (params.type === 'study') {
    const strippedTitle = stripLeadingSubjectFromTitle(
      normalizedTitle,
      normalizedSubject,
    );

    if (strippedTitle) {
      normalizedTitle = strippedTitle;
    }

    if (!normalizedTitle || normalizedTitle === normalizedSubject) {
      const rawCandidate = stripLeadingSubjectFromTitle(
        trimContentPhrase(sanitizeSuggestedTitle(params.rawText)),
        normalizedSubject,
      );

      if (rawCandidate && rawCandidate !== '分' && rawCandidate !== normalizedSubject) {
        normalizedTitle = rawCandidate;
      }
    }
  }

  if (!normalizedTitle) {
    normalizedTitle =
      params.fallbackTitle?.trim() ||
      buildDefaultPlanTitle(params.type, normalizedSubject);
  }

  return {
    subject: normalizedSubject,
    title: normalizedTitle,
  };
}

function deriveDeterministicTitle(
  inputText: string,
  subject: string,
  type: PlanType,
  fallbackTitle = '',
): string {
  const candidate = trimContentPhrase(sanitizeSuggestedTitle(inputText));

  if (candidate && candidate !== '分') {
    return candidate;
  }

  if (fallbackTitle.trim()) {
    return fallbackTitle.trim();
  }

  return buildDefaultPlanTitle(type, subject);
}

function deriveDeterministicTimeValues(
  input: SuggestionInput,
  baseDraft: PlanDraft,
): TimeResolutionResult {
  const assumptions: string[] = [];
  const unresolvedFields: SuggestionField[] = [];
  const explicitClockTime = hasExplicitClockTime(input.text);
  const durationMinutes = parseDurationMinutes(input.text);

  if (explicitClockTime) {
    const parsedTimes = parseTimes(input.text, '');
    const startTime = parsedTimes.startTime ?? '';
    let endTime = parsedTimes.endTime ?? '';

    if (!endTime && startTime && durationMinutes !== undefined) {
      endTime = timeFromMinutes(minutesFromTime(startTime) + durationMinutes);
      assumptions.push('終了時刻は開始時刻と学習時間から補いました。');
    }

    return {
      startTime,
      endTime,
      assumptions,
      unresolvedFields: mergeSuggestionFields(
        !startTime ? ['startTime'] : [],
        !endTime ? ['endTime'] : [],
      ),
    };
  }

  if (input.mode === 'edit' && baseDraft.startTime && baseDraft.endTime) {
    assumptions.push('時刻指定が無いため、既存予定の時刻を維持しました。');
    return {
      startTime: baseDraft.startTime,
      endTime: baseDraft.endTime,
      assumptions,
      unresolvedFields,
    };
  }

  if (durationMinutes !== undefined) {
    assumptions.push('学習時間は分かりましたが開始時刻が無いため、時刻は未確定です。');
  }

  return {
    startTime: '',
    endTime: '',
    assumptions,
    unresolvedFields: ['startTime', 'endTime'],
  };
}

function buildDeterministicSuggestion(
  input: SuggestionInput,
): {
  matchedPlan?: Plan;
  suggestion: NaturalLanguageSuggestion;
  explicitDate: boolean;
  explicitTime: boolean;
} {
  const matchedPlan = input.mode === 'edit' ? matchPlan(input.text, input.plans) : undefined;
  const baseDraft = buildBaseDraft(input.userId, input.selectedDate, matchedPlan);
  const explicitDate = hasExplicitDateExpression(input.text);
  const explicitTime = hasExplicitClockTime(input.text);
  const detectedType = detectType(input.text);
  const type =
    input.mode === 'edit' && matchedPlan && detectedType === 'study'
      ? matchedPlan.type
      : detectedType;
  const subject = detectSubject(input.text) || matchedPlan?.subject || '';
  const title = deriveDeterministicTitle(
    input.text,
    subject,
    type,
    input.mode === 'edit' ? matchedPlan?.title ?? '' : '',
  );
  const normalizedLabels = normalizeStudyLabels({
    rawText: input.text,
    subject,
    title,
    type,
    fallbackTitle: input.mode === 'edit' ? matchedPlan?.title ?? '' : '',
  });
  const timeValues = deriveDeterministicTimeValues(input, baseDraft);
  const unresolvedFields = mergeSuggestionFields(
    timeValues.unresolvedFields,
    !normalizedLabels.subject ? ['subject'] : [],
    !normalizedLabels.title ? ['title'] : [],
    input.mode === 'edit' && !matchedPlan ? ['targetPlan'] : [],
  );
  const assumptions = [
    ...timeValues.assumptions,
    ...(!explicitDate ? ['日付指定が無いため、選択中の日付を使いました。'] : []),
  ];

  return {
    matchedPlan,
    explicitDate,
    explicitTime,
    suggestion: {
      mode: input.mode,
      rawText: input.text,
      confidence: 0.78,
      reason:
        input.mode === 'edit'
          ? '入力文の明示情報と既存予定候補から修正案を組み立てました。'
          : '入力文の明示情報から追加案を組み立てました。',
      source: 'rules',
      providerLabel: '入力文ベース',
      status: unresolvedFields.length > 0 ? 'needs_review' : 'ready',
      matchedPlanId: matchedPlan?.id,
      parsedPlan: {
        userId: input.userId,
        title: normalizedLabels.title,
        subject: normalizedLabels.subject,
        date: explicitDate ? parseDate(input.text, input.selectedDate) : input.selectedDate,
        startTime: timeValues.startTime,
        endTime: timeValues.endTime,
        type,
        memo: mergeDistinctText(
          extractMemoHint(input.text),
          input.mode === 'edit' ? matchedPlan?.memo : undefined,
        ),
        repeat: input.mode === 'edit' ? (matchedPlan?.repeat ?? 'none') : 'none',
        repeatUntil: input.mode === 'edit' ? (matchedPlan?.repeatUntil ?? null) : null,
        excludedDates: input.mode === 'edit' ? (matchedPlan?.excludedDates ?? []) : [],
      },
      assumptions,
      unresolvedFields,
      issues: [],
    },
  };
}

async function requestPlannerExtraction(
  input: SuggestionInput,
  extraGuidance?: string,
  previousExtraction?: PlannerExtraction,
): Promise<PlannerExtraction> {
  const config = getAiConfig();

  if (config.provider === 'rules') {
    throw new Error('AI provider is disabled.');
  }

  const client = createOpenAiCompatibleClient(config);
  const heuristicMatchedPlan =
    input.mode === 'edit' ? matchPlan(input.text, input.plans) : undefined;
  const systemPrompt = [
    'あなたは日本語の勉強計画アシスタントです。',
    '入力文を意味で解釈し、1件の予定に構造化してください。',
    'JSON以外は返さないでください。',
    '日付の指定が無ければ selectedDate を使ってください。',
    '開始時刻と学習時間が明示されていれば、終了時刻を計算してください。',
    'タイトルに時間・日付・学習時間・章番号を入れないでください。',
    '章やユニットは memo に入れてください。',
    '入力文に無い教材名や章名を作らないでください。',
    '日本語の全角数字や漢数字を普通に解釈してください。',
    '例: 今日の22時から15分英単語 -> title=英単語, startTime=22:00, endTime=22:15',
    '例: 大岩の英文法 八章 15時から二時間やる -> title=大岩の英文法, memo=八章, startTime=15:00, endTime=17:00',
    extraGuidance ?? '',
  ].join('\n');
  const userPrompt = [
    `mode: ${input.mode}`,
    `selectedDate: ${input.selectedDate}`,
    `userText: ${input.text}`,
    `heuristicMatchedPlanId: ${heuristicMatchedPlan?.id ?? 'null'}`,
    previousExtraction
      ? `previousExtraction: ${JSON.stringify(previousExtraction)}`
      : '',
    'plans:',
    formatPlansForPrompt(input.plans, input.selectedDate),
  ]
    .filter(Boolean)
    .join('\n');

  const rawContent = await client.createChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0,
    responseFormat: EXTRACTION_RESPONSE_FORMAT,
  });
  const jsonText = extractFirstJsonObject(rawContent);

  if (!jsonText) {
    throw new Error('AI response did not include JSON.');
  }

  return JSON.parse(jsonText) as PlannerExtraction;
}

async function repairPlannerExtraction(
  input: SuggestionInput,
  previousExtraction: PlannerExtraction,
  issues: string[],
): Promise<PlannerExtraction> {
  return requestPlannerExtraction(
    input,
    [
      '前回の抽出には問題がありました。以下の問題を全て解消してください。',
      issues.map((issue) => `- ${issue}`).join('\n'),
      '時刻が入力文と矛盾してはいけません。',
      '入力文に無い内容を title や memo に入れてはいけません。',
    ].join('\n'),
    previousExtraction,
  );
}

function collectModelIssues(
  input: SuggestionInput,
  baseline: {
    matchedPlan?: Plan;
    suggestion: NaturalLanguageSuggestion;
    explicitDate: boolean;
    explicitTime: boolean;
  },
  extraction: PlannerExtraction,
  validationPolicy: ValidationPolicy,
): string[] {
  const issues: string[] = [];
  const normalizedDate = normalizeDate(extraction.date);
  const normalizedStartTime = normalizeTime(extraction.startTime);
  const normalizedEndTime = normalizeTime(extraction.endTime);
  const normalizedTitle = trimContentPhrase(
    sanitizeSuggestedTitle(normalizeText(extraction.title) ?? ''),
  );
  const normalizedMemo = normalizeText(extraction.memo);
  const normalizedSubject = normalizeText(extraction.subject);

  if (normalizeText(extraction.date) && !normalizedDate) {
    issues.push('date_format_invalid');
  }

  if (!baseline.explicitDate && normalizedDate && normalizedDate !== input.selectedDate) {
    issues.push('date_hallucinated');
  }

  if (normalizeText(extraction.startTime) && !normalizedStartTime) {
    issues.push('start_time_invalid');
  }

  if (normalizeText(extraction.endTime) && !normalizedEndTime) {
    issues.push('end_time_invalid');
  }

  if (normalizedStartTime && normalizedEndTime) {
    const minutesDiff =
      minutesFromTime(normalizedEndTime) - minutesFromTime(normalizedStartTime);

    if (minutesDiff <= 0) {
      issues.push('time_reversed');
    }
  }

  if (baseline.explicitTime) {
    if (
      normalizedStartTime &&
      normalizedStartTime !== baseline.suggestion.parsedPlan.startTime
    ) {
      issues.push('start_time_conflicts_with_input');
    }

    if (
      normalizedEndTime &&
      normalizedEndTime !== baseline.suggestion.parsedPlan.endTime
    ) {
      issues.push('end_time_conflicts_with_input');
    }
  }

  if (
    validationPolicy === 'strict' &&
    normalizedTitle &&
    !isGroundedInSources(
      normalizedTitle,
      input.text,
      baseline.suggestion.parsedPlan.title,
      baseline.matchedPlan?.title,
    )
  ) {
    issues.push('title_not_grounded');
  }

  if (
    validationPolicy === 'strict' &&
    normalizedMemo &&
    !isGroundedInSources(
      normalizedMemo,
      input.text,
      baseline.suggestion.parsedPlan.memo,
      baseline.matchedPlan?.memo,
    )
  ) {
    issues.push('memo_not_grounded');
  }

  if (
    validationPolicy === 'strict' &&
    normalizedSubject &&
    !isGroundedInSources(
      normalizedSubject,
      input.text,
      baseline.suggestion.parsedPlan.subject,
      baseline.suggestion.parsedPlan.title,
      baseline.matchedPlan?.subject,
    )
  ) {
    issues.push('subject_not_grounded');
  }

  return issues;
}

function isSeverelyInvalid(
  issues: string[],
  validationPolicy: ValidationPolicy,
): boolean {
  const severeIssues =
    validationPolicy === 'relaxed'
      ? [
          'date_format_invalid',
          'date_hallucinated',
          'start_time_invalid',
          'end_time_invalid',
          'time_reversed',
        ]
      : [
          'date_format_invalid',
          'date_hallucinated',
          'start_time_invalid',
          'end_time_invalid',
          'time_reversed',
          'start_time_conflicts_with_input',
          'end_time_conflicts_with_input',
          'title_not_grounded',
          'memo_not_grounded',
        ];

  return issues.some((issue) =>
    severeIssues.includes(issue),
  );
}

function buildFailedModelSuggestion(
  baseline: {
    suggestion: NaturalLanguageSuggestion;
  },
  issues: string[],
): NaturalLanguageSuggestion {
  return {
    ...baseline.suggestion,
    providerLabel: `${getAiProviderLabel()} -> 入力文ベース`,
    status: 'needs_review',
    assumptions: [
      ...baseline.suggestion.assumptions,
      '現在のAI出力は不安定だったため、入力文から再構成しました。',
      'この候補は自動確定せず、内容を確認してから反映してください。',
    ],
    issues: issues.length > 0 ? issues : ['model_output_unusable'],
  };
}

function buildLlmSuggestion(
  input: SuggestionInput,
  baseline: {
    matchedPlan?: Plan;
    suggestion: NaturalLanguageSuggestion;
    explicitDate: boolean;
    explicitTime: boolean;
  },
  extraction: PlannerExtraction,
  issues: string[],
  validationPolicy: ValidationPolicy,
): NaturalLanguageSuggestion {
  const heuristicMatchedPlanId =
    baseline.suggestion.matchedPlanId &&
    input.plans.some((plan) => plan.id === baseline.suggestion.matchedPlanId)
      ? baseline.suggestion.matchedPlanId
      : undefined;
  const llmMatchedPlanId =
    extraction.matchedPlanId &&
    input.plans.some((plan) => plan.id === extraction.matchedPlanId)
      ? extraction.matchedPlanId
      : undefined;
  const matchedPlanId =
    input.mode === 'edit' ? llmMatchedPlanId ?? heuristicMatchedPlanId : undefined;
  const matchedPlan = matchedPlanId
    ? input.plans.find((plan) => plan.id === matchedPlanId)
    : baseline.matchedPlan;
  const normalizedDate = normalizeDate(extraction.date);
  const normalizedStartTime = normalizeTime(extraction.startTime);
  const normalizedEndTime = normalizeTime(extraction.endTime);
  const normalizedTitle = trimContentPhrase(
    sanitizeSuggestedTitle(normalizeText(extraction.title) ?? ''),
  );
  const normalizedMemo = normalizeText(extraction.memo);
  const normalizedSubject = normalizeText(extraction.subject);
  const normalizedType = normalizeType(extraction.type);
  const canUseModelDate =
    Boolean(normalizedDate) &&
    !issues.includes('date_format_invalid') &&
    !issues.includes('date_hallucinated');
  const canUseModelStartTime =
    Boolean(normalizedStartTime) &&
    !issues.includes('start_time_invalid') &&
    !issues.includes('time_reversed') &&
    !issues.includes('start_time_conflicts_with_input');
  const canUseModelEndTime =
    Boolean(normalizedEndTime) &&
    !issues.includes('end_time_invalid') &&
    !issues.includes('time_reversed') &&
    !issues.includes('end_time_conflicts_with_input');
  const date =
    baseline.explicitDate || !canUseModelDate
      ? baseline.suggestion.parsedPlan.date
      : normalizedDate!;
  const startTime =
    baseline.explicitTime || !canUseModelStartTime
      ? baseline.suggestion.parsedPlan.startTime
      : normalizedStartTime!;
  const endTime =
    baseline.explicitTime || !canUseModelEndTime
      ? baseline.suggestion.parsedPlan.endTime
      : normalizedEndTime!;
  const subject =
    validationPolicy === 'relaxed'
      ? normalizedSubject ?? baseline.suggestion.parsedPlan.subject
      : normalizedSubject &&
          isGroundedInSources(
            normalizedSubject,
            input.text,
            baseline.suggestion.parsedPlan.subject,
            baseline.suggestion.parsedPlan.title,
            matchedPlan?.subject,
          )
        ? normalizedSubject
        : baseline.suggestion.parsedPlan.subject;
  const type = normalizedType ?? baseline.suggestion.parsedPlan.type;
  const title =
    validationPolicy === 'relaxed'
      ? normalizedTitle ?? baseline.suggestion.parsedPlan.title
      : normalizedTitle &&
          isGroundedInSources(
            normalizedTitle,
            input.text,
            baseline.suggestion.parsedPlan.title,
            matchedPlan?.title,
          )
        ? normalizedTitle
        : baseline.suggestion.parsedPlan.title;
  const memo =
    validationPolicy === 'relaxed'
      ? mergeDistinctText(normalizedMemo, baseline.suggestion.parsedPlan.memo)
      : normalizedMemo &&
          isGroundedInSources(
            normalizedMemo,
            input.text,
            baseline.suggestion.parsedPlan.memo,
            matchedPlan?.memo,
          )
        ? mergeDistinctText(normalizedMemo, baseline.suggestion.parsedPlan.memo)
        : baseline.suggestion.parsedPlan.memo;
  const normalizedLabels = normalizeStudyLabels({
    rawText: input.text,
    subject,
    title,
    type,
    fallbackTitle: baseline.suggestion.parsedPlan.title,
  });
  const llmAssumptions = (extraction.assumptions ?? []).filter(
    (item): item is string => Boolean(item?.trim()),
  );
  const resolvedAssumptions = [
    ...baseline.suggestion.assumptions,
    ...llmAssumptions,
    ...(issues.length > 0
      ? ['AI出力に矛盾があったため、入力文の明示情報で補正しました。']
      : []),
  ];

  const unresolvedFields = mergeSuggestionFields(
    normalizeFieldList(extraction.unresolvedFields),
    baseline.suggestion.unresolvedFields.filter((field) =>
      field === 'targetPlan' ||
      !startTime ||
      !endTime ||
      !normalizedLabels.title ||
      !normalizedLabels.subject,
    ),
    !startTime ? ['startTime'] : [],
    !endTime ? ['endTime'] : [],
    !normalizedLabels.subject ? ['subject'] : [],
    !normalizedLabels.title ? ['title'] : [],
    input.mode === 'edit' && !matchedPlanId ? ['targetPlan'] : [],
  );
  const status =
    unresolvedFields.length > 0
      ? 'failed'
      : issues.length > 0
        ? 'needs_review'
        : 'ready';

  return {
    mode: input.mode,
    rawText: input.text,
    confidence: clampConfidence(
      extraction.confidence,
      issues.length > 0 ? 0.6 : baseline.suggestion.confidence,
    ),
    reason:
      normalizeText(extraction.reason) ||
      `${getAiProviderLabel()} が入力文の意味を整理して叩き台を生成しました。`,
    source: 'llm',
    providerLabel: getAiProviderLabel(),
    status,
    matchedPlanId,
    parsedPlan: {
      userId: input.userId,
      title: normalizedLabels.title,
      subject: normalizedLabels.subject,
      date,
      startTime,
      endTime,
      type,
      memo,
      repeat:
        input.mode === 'edit' ? (baseline.suggestion.parsedPlan.repeat ?? 'none') : 'none',
      repeatUntil:
        input.mode === 'edit'
          ? (baseline.suggestion.parsedPlan.repeatUntil ?? null)
          : null,
      excludedDates:
        input.mode === 'edit'
          ? (baseline.suggestion.parsedPlan.excludedDates ?? [])
          : [],
    },
    assumptions: Array.from(new Set(resolvedAssumptions.map(sanitizeAssumptionText))),
    unresolvedFields,
    issues,
  };
}

export function getPlannerAiRuntimeInfo(
  config: AiConfig = getAiConfig(),
): PlannerAiRuntimeInfo {
  return {
    providerLabel: getAiProviderLabel(config),
    fallbackLabel: 'AIが壊れたときは入力文の明示情報から再構成します',
  };
}

async function generateSingleNaturalLanguageSuggestion(
  input: SuggestionInput,
): Promise<NaturalLanguageSuggestion> {
  const baseline = buildDeterministicSuggestion(input);
  const config = getAiConfig();
  const validationPolicy = getValidationPolicy(config);

  if (config.provider === 'rules') {
    return baseline.suggestion;
  }

  try {
    const firstExtraction = await requestPlannerExtraction(input);
    const firstIssues = collectModelIssues(
      input,
      baseline,
      firstExtraction,
      validationPolicy,
    );

    if (!isSeverelyInvalid(firstIssues, validationPolicy)) {
      return buildLlmSuggestion(
        input,
        baseline,
        firstExtraction,
        firstIssues,
        validationPolicy,
      );
    }

    const repairedExtraction = await repairPlannerExtraction(
      input,
      firstExtraction,
      firstIssues,
    );
    const repairedIssues = collectModelIssues(
      input,
      baseline,
      repairedExtraction,
      validationPolicy,
    );

    if (!isSeverelyInvalid(repairedIssues, validationPolicy)) {
      return buildLlmSuggestion(
        input,
        baseline,
        repairedExtraction,
        repairedIssues,
        validationPolicy,
      );
    }

    if (validationPolicy === 'relaxed') {
      return buildLlmSuggestion(
        input,
        baseline,
        repairedExtraction,
        repairedIssues,
        validationPolicy,
      );
    }

    return buildFailedModelSuggestion(baseline, repairedIssues);
  } catch (error) {
    const errorMessage =
      error instanceof Error && error.message.trim().length > 0
        ? error.message.trim()
        : undefined;

    console.error('[AI Planner] suggestion generation failed', {
      provider: getAiProviderLabel(),
      mode: input.mode,
      text: input.text,
      error,
    });

    return {
      ...baseline.suggestion,
      providerLabel: `${getAiProviderLabel()} -> 入力文ベース`,
      assumptions: [
        ...baseline.suggestion.assumptions,
        `${getAiProviderLabel()} に接続できなかったため、入力文から再構成しました。`,
        ...(errorMessage ? [`詳細: ${errorMessage}`] : []),
      ],
      issues: ['ai_unavailable'],
    };
  }
}

export async function generateNaturalLanguageSuggestions(
  input: SuggestionInput,
): Promise<NaturalLanguageSuggestion[]> {
  if (input.mode === 'add') {
    try {
      const suggestions =
        getAiConfig().provider === 'rules'
          ? await Promise.all(
              normalizeTaskTexts(splitAddTaskTexts(input.text), input.text).map(
                (taskText) =>
                  generateSingleNaturalLanguageSuggestion({
                    ...input,
                    text: taskText,
                  }),
              ),
            )
          : await buildBatchedAddSuggestions(input);

      return suggestions.length > 0
        ? postProcessAddSuggestions(suggestions)
        : [await generateSingleNaturalLanguageSuggestion(input)];
    } catch {
      const fallbackTaskTexts = normalizeTaskTexts(
        splitAddTaskTexts(input.text),
        input.text,
      );
      const fallbackSuggestions = await Promise.all(
        fallbackTaskTexts.map((taskText) =>
          generateSingleNaturalLanguageSuggestion({
            ...input,
            text: taskText,
          }),
        ),
      );

      return postProcessAddSuggestions(fallbackSuggestions);
    }
  }

  const suggestion = await generateSingleNaturalLanguageSuggestion(input);
  return [suggestion];
}

export async function generateNaturalLanguageSuggestion(
  input: SuggestionInput,
): Promise<NaturalLanguageSuggestion> {
  const suggestions = await generateNaturalLanguageSuggestions(input);
  return suggestions[0];
}
