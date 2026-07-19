from __future__ import annotations

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"expected one replacement in {path}, found {count}: {old[:80]!r}")
    file_path.write_text(content.replace(old, new), encoding="utf-8")


def append_once(path: str, marker: str, addition: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding="utf-8")
    if addition in content:
        return
    if marker not in content:
        raise RuntimeError(f"marker not found in {path}: {marker[:80]!r}")
    file_path.write_text(content.replace(marker, marker + addition, 1), encoding="utf-8")


# Preserve opaque trace correlation identifiers. They are random transport handles,
# not account identifiers, and redacting their UUID portions collapses all sessions.
replace_once(
    "workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts",
    """  const sessionId = requireDocumentId(input.session.id, 'trace session id');
  const expireAt = weeklyPlanningTraceExpireAt(now);
  const session = preparedDocument({ ...input.session, id: sessionId }, subject, expireAt);
  const entries = input.entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('trace entry payload is invalid');
    }
    const entryId = requireDocumentId(entry.id, 'trace entry id');
    if (entry.sessionId !== sessionId) throw new Error('trace entry session mismatch');
    return preparedDocument({ ...entry, id: entryId, sessionId }, subject, expireAt);
  });
  return { session, entries };
""",
    """  const sessionId = requireDocumentId(input.session.id, 'trace session id');
  const logicalConversationId = typeof input.session.logicalConversationId === 'string'
    ? requireDocumentId(input.session.logicalConversationId, 'logical conversation id')
    : undefined;
  const expireAt = weeklyPlanningTraceExpireAt(now);
  const session = {
    ...preparedDocument({ ...input.session, id: sessionId }, subject, expireAt),
    id: sessionId,
    ...(logicalConversationId ? { logicalConversationId } : {}),
  };
  const entries = input.entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('trace entry payload is invalid');
    }
    const entryId = requireDocumentId(entry.id, 'trace entry id');
    if (entry.sessionId !== sessionId) throw new Error('trace entry session mismatch');
    const entryConversationId = typeof entry.logicalConversationId === 'string'
      ? requireDocumentId(entry.logicalConversationId, 'entry logical conversation id')
      : undefined;
    if (logicalConversationId && entryConversationId && entryConversationId !== logicalConversationId) {
      throw new Error('trace entry conversation mismatch');
    }
    return {
      ...preparedDocument({ ...entry, id: entryId, sessionId }, subject, expireAt),
      id: entryId,
      sessionId,
      ...(entryConversationId ? { logicalConversationId: entryConversationId } : {}),
    };
  });
  return { session, entries };
""",
)

# The Firestore document name is authoritative. Legacy stored fields may contain
# the redacted placeholder, so decoded fields must not overwrite the real ID.
replace_once(
    "workers/ai-proxy/src/weeklyPlanningTraceFirestore.ts",
    "return { id: documentId(document.name), ...decodeFirestoreFields(document.fields ?? {}) };",
    "return { ...decodeFirestoreFields(document.fields ?? {}), id: documentId(document.name) };",
)
replace_once(
    "workers/ai-proxy/src/weeklyPlanningTraceFirestore.ts",
    "? [{ id: documentId(result.document.name), ...decodeFirestoreFields(result.document.fields ?? {}) }]",
    "? [{ ...decodeFirestoreFields(result.document.fields ?? {}), id: documentId(result.document.name) }]",
)

replace_once(
    "workers/ai-proxy/src/weeklyPlanningTraceApi.ts",
    """function safeDocuments(documents: Record<string, unknown>[]): Record<string, unknown>[] {
  return documents.flatMap((document) => {
    const redacted = redactWeeklyPlanningTraceValue(document);
    return isRecord(redacted) ? [redacted] : [];
  });
}
""",
    """const TRACE_STRUCTURAL_KEYS = ['id', 'sessionId', 'logicalConversationId'] as const;

export function safeWeeklyPlanningTraceDocumentsForAdmin(
  documents: Record<string, unknown>[],
): Record<string, unknown>[] {
  return documents.flatMap((document) => {
    const redacted = redactWeeklyPlanningTraceValue(document);
    if (!isRecord(redacted)) return [];
    TRACE_STRUCTURAL_KEYS.forEach((key) => {
      const value = document[key];
      if (typeof value === 'string' && /^[A-Za-z0-9:_-]{1,240}$/.test(value)) {
        redacted[key] = value;
      }
    });
    return [redacted];
  });
}
""",
)
replace_once(
    "workers/ai-proxy/src/weeklyPlanningTraceApi.ts",
    "return ok({ sessions: safeDocuments(sessions) });",
    "return ok({ sessions: safeWeeklyPlanningTraceDocumentsForAdmin(sessions) });",
)
replace_once(
    "workers/ai-proxy/src/weeklyPlanningTraceApi.ts",
    """  await appendAccessAudit(firestore, env, session, 'list_entries', sessionId);
  const entries = await firestore.queryDocuments(
    TRACE_ENTRIES,
    [{ field: 'sessionId', value: sessionId }],
    ADMIN_LIST_LIMIT,
  );
  return ok({ entries: safeDocuments(entries) });
""",
    """  const target = await firestore.getDocument(TRACE_SESSIONS, sessionId);
  if (!target) return error(404, 'trace session was not found');
  await appendAccessAudit(firestore, env, session, 'list_entries', sessionId);
  const rawEntryCount = target.entryCount;
  const entryCount = typeof rawEntryCount === 'number' && Number.isFinite(rawEntryCount)
    ? Math.max(0, Math.min(ADMIN_LIST_LIMIT, Math.trunc(rawEntryCount)))
    : 0;
  const entries = (await Promise.all(
    Array.from({ length: entryCount }, (_, sequence) =>
      firestore.getDocument(
        TRACE_ENTRIES,
        `${sessionId}-${String(sequence).padStart(8, '0')}`,
      )),
  ))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({ ...entry, sessionId }));
  return ok({ entries: safeWeeklyPlanningTraceDocumentsForAdmin(entries) });
""",
)

# Resolve an explicit request for today's plan before the generic begin command
# adds a missing weekly period.
replace_once(
    "src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts",
    """function currentTime(context: WeeklyPlanningIntakeContext): string {
  return currentDateTime(context).slice(11, 16) || '00:00';
}

type NamedPlanningRangeKind = 'this_week' | 'next_week' | 'weekend';
""",
    """function currentTime(context: WeeklyPlanningIntakeContext): string {
  return currentDateTime(context).slice(11, 16) || '00:00';
}

function parseTodayPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  expectedSlot?: string,
): SetPlanningRangeCommand['range'] | undefined {
  const normalizedText = stripQuotedSegments(normalizeIntakeText(text)).trim();
  if (hasReportedOrExampleContext(normalizedText)) return undefined;

  const explicitTodayRequest = /今日(?:の)?(?:勉強|学習)?(?:の)?(?:予定|計画|スケジュール)/.test(
    normalizedText,
  ) && /(?:立て|作|組|決め|お願い|して)/.test(normalizedText);
  const bareTodayAnswer = expectedSlot === 'planning_period'
    && /^今日(?:です|でお願いします|にします)?$/.test(normalizedText);
  if (!explicitTodayRequest && !bareTodayAnswer) return undefined;

  const startDateTime = currentDateTime(context);
  const date = startDateTime.slice(0, 10);
  return {
    startDateTime,
    endDateTime: formatDateTime(date, '24:00'),
    sourceText: text,
    calendarDayCount: 1,
    confidence: 'explicit',
  };
}

type NamedPlanningRangeKind = 'this_week' | 'next_week' | 'weekend';
""",
)
replace_once(
    "src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts",
    """  const range = parseNamedPlanningRange(text, context, expectedSlot)
    ?? parseSundayBoundPlanningRange(text, context, expectedSlot)
""",
    """  const range = parseTodayPlanningRange(text, context, expectedSlot)
    ?? parseNamedPlanningRange(text, context, expectedSlot)
    ?? parseSundayBoundPlanningRange(text, context, expectedSlot)
""",
)
replace_once(
    "src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts",
    """function extractExamFields(text: string): string[] {
  return normalizeIntakeText(text)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .map((line) => line.match(/第\s*\d+\s*部\s+(.+)$/)?.[1]?.trim())
    .filter((field): field is string => Boolean(field));
}
""",
    """function cleanExamFieldCandidate(value: string): string | undefined {
  const cleaned = value
    .replace(/^(?:違う[!！]?\s*)/, '')
    .replace(/^(?:対象(?:分野|科目)?|分野|科目)\s*(?:は|が|を)?\s*/, '')
    .replace(/\s*(?:を)?(?:進め|やり|解き|勉強し|学習し)(?:たい|ます|る)?.*$/, '')
    .replace(/\s*(?:だけ)?(?:です|だ|でお願いします)$/, '')
    .trim();
  if (!cleaned || /^(?:院試|過去問|勉強|学習)$/.test(cleaned)) return undefined;
  return cleaned;
}

function extractInlineExamFields(text: string): string[] {
  const normalizedText = normalizeIntakeText(text).replace(/\s+/g, ' ').trim();
  const combinedSubject = normalizedText.match(
    /(?:違う[!！]?\s*)?(?:分野(?:は|が|を)?\s*)?(.+?)\s*で\s*(?:一|1)\s*科目/,
  );
  if (combinedSubject) {
    const combined = cleanExamFieldCandidate(combinedSubject[1]);
    return combined ? [combined] : [];
  }

  const captured = [
    normalizedText.match(
      /(?:院試(?:の)?過去問|過去問)\s*[:：]?\s*(.+?)(?=(?:を)?(?:進め|やり|解き|勉強し|学習し)|$)/,
    )?.[1],
    normalizedText.match(/分野(?:は|が|を)?\s*(.+?)(?=だけ(?:です|だ)?|です|$)/)?.[1],
  ].filter((value): value is string => Boolean(value));

  return uniqueList(captured.flatMap((value) =>
    value
      .split(/\s*(?:、|,|，|／|\/|・|と)\s*/)
      .map(cleanExamFieldCandidate)
      .filter((field): field is string => Boolean(field)),
  ));
}

function extractExamFields(text: string): string[] {
  const sectionFields = normalizeIntakeText(text)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .map((line) => line.match(/第\s*\d+\s*部\s+(.+)$/)?.[1]?.trim())
    .filter((field): field is string => Boolean(field));
  return uniqueList([...sectionFields, ...extractInlineExamFields(text)]);
}
""",
)
replace_once(
    "src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts",
    "const match = normalizeIntakeText(text).match(/([0-9]+|[一二三四五六七八九十]+)\\s*分野/);",
    "const match = normalizeIntakeText(text).match(/([0-9]+|[一二三四五六七八九十]+)\\s*(?:分野|科目)/);",
)
replace_once(
    "src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts",
    "return /院試|分野|20\\d{2}\\s*[〜~-]\\s*20\\d{2}|第\\s*\\d+\\s*部/.test(normalizedText)",
    "return /院試|分野|科目|20\\d{2}\\s*[〜~-]\\s*20\\d{2}|第\\s*\\d+\\s*部/.test(normalizedText)",
)

# Ask priority in the actual period, not always "週末".
replace_once(
    "src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts",
    """const priorityPolicySlot: PlanningQuestionSlotDefinition = {
""",
    """function planningPeriodLabelForQuestion(state: PlanningIntakeState): string {
  const sourceText = state.range?.sourceText ?? '';
  if (/来週/.test(sourceText)) return '来週';
  if (/今週/.test(sourceText)) return '今週';
  if (/週末|土日/.test(sourceText)) return '週末';
  if (/今日/.test(sourceText) || state.range?.calendarDayCount === 1) return '今日';
  return state.pendingPlanningRange?.scope.label ?? 'この期間';
}

const priorityPolicySlot: PlanningQuestionSlotDefinition = {
""",
)
replace_once(
    "src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts",
    """  deterministicQuestion: () =>
    '週末で優先する分野や進める順番を教えてください。',
""",
    """  deterministicQuestion: (state) =>
    `${planningPeriodLabelForQuestion(state)}で優先する分野や進める順番を教えてください。`,
""",
)
replace_once(
    "src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts",
    """  fallbackQuestion: () =>
    '週末で優先する分野や進める順番を教えてください。',
""",
    """  fallbackQuestion: ({ planningPeriodLabel }) =>
    `${planningPeriodLabel ?? 'この期間'}で優先する分野や進める順番を教えてください。`,
""",
)

# Render only facts accepted in the current turn, preserve the user's duration unit,
# and perform a focused repair instead of repeating two unchanged questions.
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """    fields?: string[];
    goals?: string[];
    yearRange?: { startYear: number; endYear: number };
    unitRateMinutes?: number;
""",
    """    fields?: string[];
    totalFields?: number;
    goals?: string[];
    yearRange?: { startYear: number; endYear: number };
    unitRateMinutes?: number;
    unitRateDisplay?: string;
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """function planningPeriodLabel(state: PlanningIntakeState): string | undefined {
  const source = state.range?.sourceText;

  if (source) {
""",
    """function normalizedTurnText(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function acceptedFromLatestTurn(source: string | undefined, latestTurn: string): boolean {
  const normalizedSource = normalizedTurnText(source);
  const normalizedLatest = normalizedTurnText(latestTurn);
  return Boolean(normalizedSource && normalizedLatest && (
    normalizedSource === normalizedLatest
    || normalizedLatest.includes(normalizedSource)
    || normalizedSource.includes(normalizedLatest)
  ));
}

function planningPeriodLabel(
  state: PlanningIntakeState,
  latestTurn: string,
): string | undefined {
  const source = state.range?.sourceText;
  if (source && !acceptedFromLatestTurn(source, latestTurn)) return undefined;

  if (source) {
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """function unitRateBasisLabel(state: PlanningIntakeState): string | undefined {
  return state.examPrepScope?.unitModel === 'year_field_chunk'
    ? '1年分・1分野あたり'
    : undefined;
}
""",
    """function unitRateBasisLabel(state: PlanningIntakeState): string | undefined {
  return state.examPrepScope?.unitModel === 'year_field_chunk'
    ? '1年分・1分野あたり'
    : undefined;
}

function unitRateDisplayLabel(rawText: string | undefined, minutes: number): string {
  const match = rawText?.match(
    /([0-9０-９]+(?:\.[0-9０-９]+)?|[一二三四五六七八九十]+)\s*(時間|分)/,
  );
  return match ? `${match[1]}${match[2]}` : `${minutes}分`;
}
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """export function createDialogueRenderInput(params: {
  state: PlanningIntakeState;
  decision: WeeklyPlanningDialogueDecision;
  existingPlans?: Plan[];
}): DialogueRenderInput {
  const unitRate = params.state.unitRates.find((rate) => typeof rate.minutesPerUnit === 'number');
""",
    """export function createDialogueRenderInput(params: {
  state: PlanningIntakeState;
  previousState?: PlanningIntakeState;
  decision: WeeklyPlanningDialogueDecision;
  existingPlans?: Plan[];
}): DialogueRenderInput {
  const latestTurn = params.state.sourceTurns.at(-1) ?? '';
  const unitRate = params.state.unitRates.find((rate) =>
    typeof rate.minutesPerUnit === 'number'
    && acceptedFromLatestTurn(rate.rawText, latestTurn),
  );
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """  const commandGoalTitles = params.state.tasks
    .filter((task) => task.source === 'command')
    .map((task) => task.title);
""",
    """  const commandGoalTitles = params.state.tasks
    .filter((task) => task.source === 'command' && acceptedFromLatestTurn(task.rawText, latestTurn))
    .map((task) => task.title);
  const examScopeAcceptedThisTurn = params.state.examPrepScope?.rawText.some(
    (sourceText) => acceptedFromLatestTurn(sourceText, latestTurn),
  ) ?? false;
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """  return {
    planningPeriodLabel: planningPeriodLabel(params.state),
    unitRateBasisLabel: unitRateBasisLabel(params.state),
    constraintSourcesInUse: constraintSourcesInUseLabels(params.state),
""",
    """  const nextQuestions = nextQuestionsFromDecision(
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
  const mentionsConstraintSource = /時間割|予定表|登録済みの予定|保存済みの予定/.test(latestTurn);

  return {
    planningPeriodLabel: planningPeriodLabel(params.state, latestTurn),
    unitRateBasisLabel: unitRateBasisLabel(params.state),
    constraintSourcesInUse: mentionsConstraintSource
      ? constraintSourcesInUseLabels(params.state)
      : undefined,
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """    acceptedFacts: {
      fields: params.state.examPrepScope?.fields,
      goals: commandGoalTitles.length > 0 ? commandGoalTitles : undefined,
      yearRange: params.state.examPrepScope?.yearRange
        ? {
            startYear: params.state.examPrepScope.yearRange.startYear,
            endYear: params.state.examPrepScope.yearRange.endYear,
          }
        : undefined,
      unitRateMinutes: unitRate?.minutesPerUnit,
      priorityOrder,
      constraintSummary: constraintSummary(params.state),
    },
    assumptions: [...params.state.assumptions],
    nextQuestions: nextQuestionsFromDecision(
      params.decision,
      2,
      unitRateBasisLabel(params.state),
    ),
    styleConstraints: { tone: 'mentor', maxQuestions: 2 },
""",
    """    acceptedFacts: {
      fields: examScopeAcceptedThisTurn ? params.state.examPrepScope?.fields : undefined,
      totalFields: examScopeAcceptedThisTurn ? params.state.examPrepScope?.totalFields : undefined,
      goals: commandGoalTitles.length > 0 ? commandGoalTitles : undefined,
      yearRange: params.state.examPrepScope?.yearRange
        && latestTurn.includes(params.state.examPrepScope.yearRange.sourceText)
        ? {
            startYear: params.state.examPrepScope.yearRange.startYear,
            endYear: params.state.examPrepScope.yearRange.endYear,
          }
        : undefined,
      unitRateMinutes: unitRate?.minutesPerUnit,
      unitRateDisplay: unitRate && typeof unitRate.minutesPerUnit === 'number'
        ? unitRateDisplayLabel(unitRate.rawText, unitRate.minutesPerUnit)
        : undefined,
      priorityOrder: undefined,
      constraintSummary: params.state.constraints
        .filter((constraint) => acceptedFromLatestTurn(constraint.rawText, latestTurn))
        .map((constraint) => [constraint.kind, constraint.date, constraint.start, constraint.end]
          .filter(Boolean)
          .join(' ')),
    },
    assumptions: [...params.state.assumptions],
    nextQuestions: renderedQuestions,
    styleConstraints: { tone: 'mentor', maxQuestions: shouldRepairRepeatedQuestion ? 1 : 2 },
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """    const text = plannedQuestion.slotKey === 'fixed_events'
      || plannedQuestion.slotKey === 'planning_start_date'
""",
    """    const text = plannedQuestion.questionKind === 'repair'
      || plannedQuestion.slotKey === 'planning_period'
      || plannedQuestion.slotKey === 'fixed_events'
      || plannedQuestion.slotKey === 'planning_start_date'
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """function formatAcceptedFacts(input: DialogueRenderInput): string | null {
  const facts = [
    input.acceptedFacts.fields?.length
      ? `対象分野は${input.acceptedFacts.fields.join('、')}`
      : null,
""",
    """function formatAcceptedFacts(input: DialogueRenderInput): string | null {
  const fields = input.acceptedFacts.fields ?? [];
  const fieldList = fields.length === 2 ? fields.join('と') : fields.join('、');
  const facts = [
    fields.length
      ? input.acceptedFacts.totalFields === 1 && fields.length === 1
        ? `${fieldList}を1科目`
        : `${fieldList}の${fields.length}分野`
      : null,
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """    typeof input.acceptedFacts.unitRateMinutes === 'number'
      ? `${input.unitRateBasisLabel ?? '1単位あたり'}の目安時間は${input.acceptedFacts.unitRateMinutes}分`
      : null,
""",
    """    typeof input.acceptedFacts.unitRateMinutes === 'number'
      ? `${input.unitRateBasisLabel ?? '1単位あたり'}の目安時間は${input.acceptedFacts.unitRateDisplay ?? `${input.acceptedFacts.unitRateMinutes}分`}`
      : null,
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """function fallbackQuestionText(
  question: DialogueNextQuestion,
  planningPeriodLabel?: string,
  knownFixedEventSummaries?: string[],
  unitRateBasis?: string,
): string {
  return fallbackQuestionForSlot(question.slotKey, {
""",
    """function fallbackQuestionText(
  question: DialogueNextQuestion,
  planningPeriodLabel?: string,
  knownFixedEventSummaries?: string[],
  unitRateBasis?: string,
): string {
  if (question.questionKind === 'repair') {
    switch (question.slotKey) {
      case 'priority_policy':
        return '進める順番だけ確認します。どちらを先にしますか？同じ優先度でも構いません。';
      case 'sleep_cycle':
        return '開始できる時刻だけ確認します。何時から勉強できますか？';
      case 'fixed_events':
        return '固定予定についてだけ確認します。登録済み以外に、動かせない予定はありますか？';
      case 'unit_rate':
        return `${unitRateBasis ?? '1単位あたり'}の目安時間だけ確認します。だいたい何時間かかりますか？`;
      case 'planning_period':
        return '計画期間だけ確認します。いつからいつまでにしますか？';
      default:
        return fallbackQuestionForSlot(question.slotKey, {
          planningPeriodLabel,
          options: question.options,
          knownFixedEventSummaries,
          unitRateBasisLabel: unitRateBasis,
        }) ?? '未回答の条件を一つだけ確認します。';
    }
  }
  return fallbackQuestionForSlot(question.slotKey, {
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """  const input = createDialogueRenderInput({
    state: params.state,
    decision: params.decision,
    existingPlans: params.existingPlans,
  });
""",
    """  const input = createDialogueRenderInput({
    state: params.state,
    previousState: params.previousState,
    decision: params.decision,
    existingPlans: params.existingPlans,
  });
""",
)
replace_once(
    "src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts",
    """export async function renderWeeklyPlanningDialogueMessage(params: {
  state: PlanningIntakeState;
  decision: WeeklyPlanningDialogueDecision;
""",
    """export async function renderWeeklyPlanningDialogueMessage(params: {
  state: PlanningIntakeState;
  previousState?: PlanningIntakeState;
  decision: WeeklyPlanningDialogueDecision;
""",
)

replace_once(
    "src/features/weeklyPlanning/weeklyPlanningTurnExecutor.ts",
    """    ? await renderWeeklyPlanningDialogueMessage({
      state: pipelineOutput.state,
      decision: pipelineOutput.decision,
""",
    """    ? await renderWeeklyPlanningDialogueMessage({
      state: pipelineOutput.state,
      previousState: input.previousState,
      decision: pipelineOutput.decision,
""",
)

append_once(
    "src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts",
    """    '- For Japanese exam years like 2025〜2019, set yearRange.startYear to 2025 and endYear to 2019.',
""",
    """    '- When an entrance-exam turn names content after 過去問, extract the named fields. Treat AとB as two fields by default and emit fields=[A,B].',
    '- An explicit correction such as 「違う、AとBで一科目」 replaces the previous scope: emit fields=[AとB] and totalFields=1 instead of appending A and B separately.',
""",
)

# Regression tests for the observed conversation and structural trace identifiers.
Path("src/features/weeklyPlanning/__tests__/weeklyPlanningObservedConversationRegression.test.ts").write_text(
    """import { describe, expect, it } from 'vitest';
import { renderWeeklyPlanningDialogueMessage } from '../dialogue/weeklyPlanningDialogueRenderer';
import {
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import { runWeeklyPlanningIntakePipeline } from '../pipeline/weeklyPlanningIntakePipeline';

const context = {
  selectedDate: '2026-07-19',
  planningDayCount: 7,
  currentDateTime: '2026-07-19T20:30:00',
  weekStartsOn: 'monday' as const,
};

function runTurn(previousState: ReturnType<typeof createInitialPlanningIntakeState> | undefined, userText: string) {
  return runWeeklyPlanningIntakePipeline({
    previousState,
    userText,
    planningStartDate: context.selectedDate,
    planningDayCount: context.planningDayCount,
    currentDateTime: context.currentDateTime,
    weekStartsOn: context.weekStartsOn,
  });
}

describe('observed weekly planning conversation regressions', () => {
  it('accepts 今日の勉強計画 as a one-day range instead of asking for a week', () => {
    const output = runTurn(undefined, '今日の勉強計画を立ててください');

    expect(output.state.range).toEqual({
      startDateTime: '2026-07-19T20:30:00',
      endDateTime: '2026-07-19T24:00:00',
      sourceText: '今日の勉強計画を立ててください',
      calendarDayCount: 1,
      confidence: 'explicit',
    });
    expect(output.state.missing).not.toContain('planning_period');
    expect(output.decision.questionPlan?.[0]?.targetSlot).toBe('tasks_or_goals');
  });

  it('extracts OS and network as two fields and accepts an explicit one-subject correction', () => {
    const afterRange = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '今日の勉強計画を立ててください',
      context,
    );
    const afterScope = applyWeeklyPlanningUserTurn(
      afterRange,
      '院試の過去問 OSとネットワークを進めたいです',
      context,
    );

    expect(afterScope.examPrepScope?.fields).toEqual(['OS', 'ネットワーク']);

    const corrected = applyWeeklyPlanningUserTurn(
      afterScope,
      '違う！OSとネットワークで一科目です',
      context,
    );
    expect(corrected.examPrepScope?.fields).toEqual(['OSとネットワーク']);
    expect(corrected.examPrepScope?.totalFields).toBe(1);
  });

  it('acknowledges only facts accepted in the current turn and keeps 3時間 as written', async () => {
    const first = runTurn(undefined, '今日の勉強計画を立ててください');
    const second = runTurn(first.state, '院試の過去問 OSとネットワークを進めたいです');
    const scopeMessage = await renderWeeklyPlanningDialogueMessage({
      state: second.state,
      previousState: first.state,
      decision: second.decision,
    });

    expect(scopeMessage).toContain('OSとネットワークの2分野');
    expect(scopeMessage).not.toContain('今日の計画ですね');

    const third = runTurn(second.state, '3時間ぐらいです\n予定は特にないです');
    const durationMessage = await renderWeeklyPlanningDialogueMessage({
      state: third.state,
      previousState: second.state,
      decision: third.decision,
    });

    expect(durationMessage).toContain('目安時間は3時間');
    expect(durationMessage).not.toContain('180分');
    expect(durationMessage).not.toContain('今日の計画ですね');
  });

  it('repairs an unanswered repeated question by paraphrasing and narrowing to one question', async () => {
    const first = runTurn(undefined, '今日の勉強計画を立ててください');
    const second = runTurn(first.state, '院試の過去問 OSとネットワークを進めたいです');
    const third = runTurn(second.state, '3時間ぐらいです\n予定は特にないです');
    const fourth = runTurn(third.state, '分野はOSとネットワークだけです');
    const message = await renderWeeklyPlanningDialogueMessage({
      state: fourth.state,
      previousState: third.state,
      decision: fourth.decision,
    });

    expect(message).toContain('OSとネットワークの2分野');
    expect(message).toContain('進める順番だけ確認します');
    expect(message).not.toContain('睡眠時間や');
    expect(message.split('\n').filter((line) => line.includes('？'))).toHaveLength(1);
  });
});
""",
    encoding="utf-8",
)

Path("workers/ai-proxy/src/weeklyPlanningTraceStructuralIds.test.ts").write_text(
    """import { describe, expect, it } from 'vitest';
import { safeWeeklyPlanningTraceDocumentsForAdmin } from './weeklyPlanningTraceApi';
import { prepareWeeklyPlanningTraceWrite } from './weeklyPlanningTracePrivacy';

const SESSION_ID = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';
const OTHER_SESSION_ID = 'weekly-trace-223e4567-e89b-12d3-a456-426614174000';
const CONVERSATION_ID = 'weekly-conversation-323e4567-e89b-12d3-a456-426614174000';

describe('weekly planning trace structural identifiers', () => {
  it('keeps random correlation IDs unique while removing account identity', () => {
    const prepared = prepareWeeklyPlanningTraceWrite({
      session: {
        id: SESSION_ID,
        logicalConversationId: CONVERSATION_ID,
        userId: 'firebase-user-123',
      },
      entries: [{
        id: `${SESSION_ID}-00000000`,
        sessionId: SESSION_ID,
        logicalConversationId: CONVERSATION_ID,
        userId: 'firebase-user-123',
      }],
    }, { token: 'wpt_subject', epoch: '100' }, '2026-07-19T00:00:00.000Z');

    expect(prepared.session.id).toBe(SESSION_ID);
    expect(prepared.session.logicalConversationId).toBe(CONVERSATION_ID);
    expect(prepared.entries[0].sessionId).toBe(SESSION_ID);
    expect(JSON.stringify(prepared)).not.toContain('firebase-user-123');
  });

  it('preserves distinct admin lookup handles instead of collapsing UUIDs', () => {
    const documents = safeWeeklyPlanningTraceDocumentsForAdmin([
      { id: SESSION_ID, logicalConversationId: CONVERSATION_ID, traceSubjectToken: 'wpt_a' },
      { id: OTHER_SESSION_ID, logicalConversationId: CONVERSATION_ID, traceSubjectToken: 'wpt_b' },
    ]);

    expect(documents.map((document) => document.id)).toEqual([SESSION_ID, OTHER_SESSION_ID]);
    expect(JSON.stringify(documents)).not.toContain('traceSubjectToken');
  });
});
""",
    encoding="utf-8",
)
