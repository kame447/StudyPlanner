import { readFileSync, writeFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function write(path, content) {
  writeFileSync(path, content, 'utf8');
}

function replaceOnce(path, before, after) {
  const source = read(path);
  const first = source.indexOf(before);
  if (first < 0) {
    throw new Error(`anchor not found: ${path}\n${before.slice(0, 160)}`);
  }
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`anchor is not unique: ${path}\n${before.slice(0, 160)}`);
  }
  write(path, source.slice(0, first) + after + source.slice(first + before.length));
}

function appendOnce(path, marker, content) {
  const source = read(path);
  if (source.includes(marker)) return;
  write(path, `${source.trimEnd()}\n\n${content.trim()}\n`);
}

function create(path, content) {
  write(path, `${content.trim()}\n`);
}

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningInterpreterTypes.ts',
  `export interface InterpreterStateSummary {\n  knownFields: string[];\n  confirmedSlots: string[];`,
  `export interface InterpreterStateSummary {\n  knownFields: string[];\n  examScopeSummary?: {\n    fields: string[];\n    yearRange?: {\n      startYear: number;\n      endYear: number;\n    };\n  };\n  confirmedSlots: string[];`,
);

replaceOnce(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts',
  `  if (state.examPrepScope) slots.push('exam_scope');`,
  `  if ((state.examPrepScope?.fields.length ?? 0) > 0) slots.push('exam_scope');`,
);

replaceOnce(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts',
  `  return {\n    knownFields: state.examPrepScope?.fields ?? [],\n    confirmedSlots: confirmedSlotsFromState(state),`,
  `  return {\n    knownFields: state.examPrepScope?.fields ?? [],\n    examScopeSummary: state.examPrepScope\n      ? {\n        fields: [...state.examPrepScope.fields],\n        ...(state.examPrepScope.yearRange\n          ? {\n            yearRange: {\n              startYear: state.examPrepScope.yearRange.startYear,\n              endYear: state.examPrepScope.yearRange.endYear,\n            },\n          }\n          : {}),\n      }\n      : undefined,\n    confirmedSlots: confirmedSlotsFromState(state),`,
);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `    case 'set_exam_scope':\n      return command.scope.yearRange ? ['exam_scope', 'year_range'] : ['exam_scope'];`,
  `    case 'set_exam_scope': {\n      const slots: string[] = [];\n      if (command.scope.fields.length > 0) slots.push('exam_scope');\n      if (command.scope.yearRange) slots.push('year_range');\n      return slots;\n    }`,
);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `function addRejected(\n  result: CandidateValidationResult,`,
  `function sameStringSet(left: readonly string[], right: readonly string[]): boolean {\n  if (left.length !== right.length) return false;\n  const rightSet = new Set(right);\n  return left.every((value) => rightSet.has(value));\n}\n\nfunction sameYearRange(\n  left: { startYear: number; endYear: number } | undefined,\n  right: { startYear: number; endYear: number } | undefined,\n): boolean {\n  if (!left || !right) return left === right;\n  return left.startYear === right.startYear && left.endYear === right.endYear;\n}\n\nfunction isSafeConfirmedSlotEnrichment(params: {\n  command: ParsedWeeklyPlanningCommand;\n  summary: InterpreterStateSummary;\n  confirmedOverlaps: string[];\n  unconfirmedSlots: string[];\n}): boolean {\n  if (params.command.type !== 'set_exam_scope' || params.unconfirmedSlots.length === 0) {\n    return false;\n  }\n\n  const existing = params.summary.examScopeSummary;\n  if (!existing) return false;\n\n  if (\n    params.confirmedOverlaps.includes('exam_scope')\n    && params.command.scope.fields.length > 0\n    && !sameStringSet(params.command.scope.fields, existing.fields)\n  ) {\n    return false;\n  }\n\n  if (\n    params.confirmedOverlaps.includes('year_range')\n    && params.command.scope.yearRange\n    && !sameYearRange(params.command.scope.yearRange, existing.yearRange)\n  ) {\n    return false;\n  }\n\n  return true;\n}\n\nfunction addRejected(\n  result: CandidateValidationResult,`,
);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `    if (slots.some((slot) => summary.confirmedSlots.includes(slot))) {\n      addRejected(result, candidate, 'confirmed-slot-overwrite');\n      return;\n    }`,
  `    const confirmedOverlaps = slots.filter((slot) => summary.confirmedSlots.includes(slot));\n    const unconfirmedSlots = slots.filter((slot) => !summary.confirmedSlots.includes(slot));\n    if (\n      confirmedOverlaps.length > 0\n      && !isSafeConfirmedSlotEnrichment({\n        command,\n        summary,\n        confirmedOverlaps,\n        unconfirmedSlots,\n      })\n    ) {\n      addRejected(result, candidate, 'confirmed-slot-overwrite');\n      return;\n    }`,
);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningMissingStatus.ts',
  `function applyPriorityMissingState(state: PlanningIntakeState): PlanningIntakeState {\n  if (\n    state.examPrepScope &&\n    state.unitRates.length > 0 &&\n    state.priorityPolicy.kind === 'unknown' &&\n    !state.missing.includes('year_range') &&\n    !state.missing.includes('completion_direction')\n  ) {\n    return {\n      ...state,\n      missing: addMissing(state.missing, [\n        'priority_policy',\n        'next_field_after_math',\n      ]),\n    };\n  }\n\n  return state;\n}`,
  `function applyPriorityMissingState(state: PlanningIntakeState): PlanningIntakeState {\n  const fields = state.examPrepScope?.fields ?? [];\n  const isPriorityStage = Boolean(\n    state.examPrepScope\n    && state.unitRates.length > 0\n    && !state.missing.includes('year_range')\n    && !state.missing.includes('completion_direction'),\n  );\n\n  if (!isPriorityStage) return state;\n\n  if (fields.length <= 1) {\n    const missing = removeMissing(state.missing, [\n      'priority_policy',\n      'next_field_after_math',\n    ]);\n\n    if (fields.length === 1 && state.priorityPolicy.kind === 'unknown') {\n      return {\n        ...state,\n        priorityPolicy: { kind: 'field_first', order: [fields[0]] },\n        missing,\n      };\n    }\n\n    return missing.length === state.missing.length ? state : { ...state, missing };\n  }\n\n  if (state.priorityPolicy.kind === 'unknown') {\n    return {\n      ...state,\n      missing: addMissing(state.missing, [\n        'priority_policy',\n        'next_field_after_math',\n      ]),\n    };\n  }\n\n  return state;\n}`,
);

create(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningKnownFixedEvents.ts',
  `import type { Plan } from '../../../types/domain';\nimport type { PlanningRange } from '../intake/weeklyPlanningIntakeTypes';\n\nfunction dateOnly(value: string | undefined): string | undefined {\n  return value?.slice(0, 10);\n}\n\nfunction formatDate(date: string): string {\n  const [, month = '', day = ''] = date.split('-');\n  return \`${Number(month)}/\${Number(day)}\`;\n}\n\nfunction formatPlan(plan: Plan): string {\n  return \`${formatDate(plan.date)} \${plan.startTime}〜\${plan.endTime}「\${plan.title}」\`;\n}\n\nexport function createKnownFixedEventSummaries(\n  plans: readonly Plan[],\n  range: PlanningRange | undefined,\n  maxItems = 3,\n): string[] {\n  const startDate = dateOnly(range?.startDateTime);\n  const endDate = dateOnly(range?.endDateTime);\n  if (!startDate || !endDate || maxItems <= 0) return [];\n\n  const matching = plans\n    .filter((plan) => plan.date >= startDate && plan.date <= endDate)\n    .sort((left, right) =>\n      left.date.localeCompare(right.date)\n      || left.startTime.localeCompare(right.startTime)\n      || left.endTime.localeCompare(right.endTime)\n      || left.title.localeCompare(right.title),\n    );\n  const summaries = matching.slice(0, maxItems).map(formatPlan);\n  const remaining = matching.length - summaries.length;\n  return remaining > 0 ? [...summaries, \`ほか\${remaining}件\`] : summaries;\n}`,
);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts',
  `interface FallbackQuestionContext {\n  planningPeriodLabel?: string;\n  options?: string[];\n}`,
  `interface FallbackQuestionContext {\n  planningPeriodLabel?: string;\n  options?: string[];\n  knownFixedEventSummaries?: string[];\n}`,
);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts',
  `  termExplanation:\n    '「固定の予定」は、授業・バイト・通院など、時間が決まっていて動かせない予定のことです。',\n  clarificationKeywords: [/固定|動かせない/],\n  vocabularyHint: '授業・バイト・通院など動かせない予定',\n  fallbackQuestion: () =>\n    '授業・バイト・通院など、動かせない予定があれば教えてください。',\n  userLabel: '授業・バイト・病院・ゼミなどの固定予定の有無',`,
  `  termExplanation:\n    '「固定の予定」は、時間が決まっていて動かせない予定のことです。',\n  clarificationKeywords: [/固定|動かせない/],\n  vocabularyHint: '時間が決まっていて動かせない予定',\n  fallbackQuestion: ({ knownFixedEventSummaries }) =>\n    knownFixedEventSummaries && knownFixedEventSummaries.length > 0\n      ? \`登録済みの予定は、\${knownFixedEventSummaries.join('、')}です。これ以外に、時間が決まっていて動かせない予定はありますか？\`\n      : 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？',\n  userLabel: '時間が決まっていて動かせない予定',`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
  `import type { ConstraintSourceRef, PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';`,
  `import type { Plan } from '../../../types/domain';\nimport type { ConstraintSourceRef, PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';\nimport { createKnownFixedEventSummaries } from './weeklyPlanningKnownFixedEvents';`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
  `  constraintSourcesInUse?: string[];\n  acceptedFacts: {`,
  `  constraintSourcesInUse?: string[];\n  knownFixedEventSummaries?: string[];\n  acceptedFacts: {`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
  `export function createDialogueRenderInput(params: {\n  state: PlanningIntakeState;\n  decision: WeeklyPlanningDialogueDecision;\n}): DialogueRenderInput {`,
  `export function createDialogueRenderInput(params: {\n  state: PlanningIntakeState;\n  decision: WeeklyPlanningDialogueDecision;\n  existingPlans?: Plan[];\n}): DialogueRenderInput {`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
  `  const commandGoalTitles = params.state.tasks\n    .filter((task) => task.source === 'command')\n    .map((task) => task.title);`,
  `  const commandGoalTitles = params.state.tasks\n    .filter((task) => task.source === 'command')\n    .map((task) => task.title);\n  const knownFixedEventSummaries = createKnownFixedEventSummaries(\n    params.existingPlans ?? [],\n    params.state.range,\n  );`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
  `    constraintSourcesInUse: constraintSourcesInUseLabels(params.state),\n    acceptedFacts: {`,
  `    constraintSourcesInUse: constraintSourcesInUseLabels(params.state),\n    knownFixedEventSummaries: knownFixedEventSummaries.length > 0\n      ? knownFixedEventSummaries\n      : undefined,\n    acceptedFacts: {`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
  `  const questions = plannedQuestions.map((plannedQuestion) => outputBySlotKey.get(plannedQuestion.slotKey));\n  if (questions.some((question) => !question)) {`,
  `  const questions = plannedQuestions.map((plannedQuestion) => {\n    const renderedQuestion = outputBySlotKey.get(plannedQuestion.slotKey);\n    if (!renderedQuestion) return undefined;\n    return plannedQuestion.slotKey === 'fixed_events'\n      ? {\n        ...renderedQuestion,\n        text: fallbackQuestionText(\n          plannedQuestion,\n          input.planningPeriodLabel,\n          input.knownFixedEventSummaries,\n        ),\n      }\n      : renderedQuestion;\n  });\n  if (questions.some((question) => !question)) {`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
  `function fallbackQuestionText(\n  question: DialogueNextQuestion,\n  planningPeriodLabel?: string,\n): string {\n  return fallbackQuestionForSlot(question.slotKey, {\n    planningPeriodLabel,\n    options: question.options,\n  }) ?? '次に確認したい条件を教えてください。';\n}`,
  `function fallbackQuestionText(\n  question: DialogueNextQuestion,\n  planningPeriodLabel?: string,\n  knownFixedEventSummaries?: string[],\n): string {\n  return fallbackQuestionForSlot(question.slotKey, {\n    planningPeriodLabel,\n    options: question.options,\n    knownFixedEventSummaries,\n  }) ?? '次に確認したい条件を教えてください。';\n}`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
  `.map((question) => fallbackQuestionText(question, input.planningPeriodLabel));`,
  `.map((question) => fallbackQuestionText(\n      question,\n      input.planningPeriodLabel,\n      input.knownFixedEventSummaries,\n    ));`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
  `export async function renderWeeklyPlanningDialogueMessage(params: {\n  state: PlanningIntakeState;\n  decision: WeeklyPlanningDialogueDecision;\n  renderer?: WeeklyPlanningDialogueRenderer;\n  userId?: string;\n}): Promise<string> {\n  const input = createDialogueRenderInput({\n    state: params.state,\n    decision: params.decision,\n  });`,
  `export async function renderWeeklyPlanningDialogueMessage(params: {\n  state: PlanningIntakeState;\n  decision: WeeklyPlanningDialogueDecision;\n  renderer?: WeeklyPlanningDialogueRenderer;\n  userId?: string;\n  existingPlans?: Plan[];\n}): Promise<string> {\n  const input = createDialogueRenderInput({\n    state: params.state,\n    decision: params.decision,\n    existingPlans: params.existingPlans,\n  });`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.ts',
  `    'constraintSourcesInUse lists schedule sources already used as constraints. Do not ask again about what those sources already cover; you may briefly acknowledge them.',`,
  `    'constraintSourcesInUse lists schedule sources already used as constraints. Do not ask again about what those sources already cover; you may briefly acknowledge them.',\n    'knownFixedEventSummaries contains exact saved plan summaries. For a fixed_events question, mention only those summaries and ask whether there are any additional immovable events. Never invent another event.',`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.ts',
  `    constraintSourcesInUse: input.constraintSourcesInUse,\n    acceptedFacts: input.acceptedFacts,`,
  `    constraintSourcesInUse: input.constraintSourcesInUse,\n    knownFixedEventSummaries: input.knownFixedEventSummaries,\n    acceptedFacts: input.acceptedFacts,`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.ts',
  `    constraintSummary: string[];\n  };`,
  `    constraintSummary: string[];\n    knownFixedEventSummaries: string[];\n  };`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.ts',
  `    'Do not claim preview generation unless generate_preview is present in allowedActions.',`,
  `    'Do not claim preview generation unless generate_preview is present in allowedActions.',\n    'When acceptedFacts.knownFixedEventSummaries is non-empty, use only those exact saved plans when asking about additional fixed events. Never invent an event.',`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.ts',
  `    case 'fixed_events':\n      return '例えば「月曜日の18時から20時はバイトです」または「固定の予定はありません」のように答えてください。';`,
  `    case 'fixed_events':\n      return '例えば「土曜日の14時から16時は予定があります」または「ほかにはありません」のように答えてください。';`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.ts',
  `function fallbackTextForAction(\n  action: AllowedDialogueAction,`,
  `function groundedAvailabilityQuestion(input: BehaviorAwareDialoguePlannerInput): string {\n  const summaries = input.acceptedFacts.knownFixedEventSummaries;\n  return summaries.length > 0\n    ? \`登録済みの予定は、\${summaries.join('、')}です。これ以外に、時間が決まっていて動かせない予定はありますか？\`\n    : '時間割・登録済み予定を使うか、ほかに時間が決まっていて動かせない予定があるか教えてください。';\n}\n\nfunction fallbackTextForAction(\n  action: AllowedDialogueAction,`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.ts',
  `      if (action.topicId === 'availability-basis') {\n        return '使える時間は、時間割・登録済み予定を使うか、空いている時間を直接教えてください。';\n      }`,
  `      if (action.topicId === 'availability-basis') {\n        return groundedAvailabilityQuestion(input);\n      }`,
);

replaceOnce(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.ts',
  `      if (action.topicId === 'availability-basis' || action.topicId === 'feasibility_basis') {\n        return '時間割・登録済み予定を使うか、空いている時間を直接教えてください。';\n      }`,
  `      if (action.topicId === 'availability-basis' || action.topicId === 'feasibility_basis') {\n        return groundedAvailabilityQuestion(input);\n      }`,
);

replaceOnce(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline.ts',
  `import type { AllowedDialogueAction } from '../planning/weeklyPlanningBehaviorTypes';`,
  `import type { AllowedDialogueAction } from '../planning/weeklyPlanningBehaviorTypes';\nimport { createKnownFixedEventSummaries } from '../dialogue/weeklyPlanningKnownFixedEvents';`,
);

replaceOnce(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningBehaviorAwareIntakePipeline.ts',
  `      constraintSummary: constraintSummary(params.base),\n    },`,
  `      constraintSummary: constraintSummary(params.base),\n      knownFixedEventSummaries: createKnownFixedEventSummaries(\n        params.input.existingPlans ?? [],\n        params.base.state.range,\n      ),\n    },`,
);

replaceOnce(
  'src/features/weeklyPlanning/types.ts',
  `import type { PlanType } from '../../types/domain';`,
  `import type { PlanType } from '../../types/domain';\nimport type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';`,
);

replaceOnce(
  'src/features/weeklyPlanning/types.ts',
  `  messages: WeeklyPlanningMessage[];\n  lastAssistantMessage?: string;`,
  `  messages: WeeklyPlanningMessage[];\n  intakeState?: PlanningIntakeState;\n  lastAssistantMessage?: string;`,
);

replaceOnce(
  'src/features/weeklyPlanning/types.ts',
  `  | { type: 'append_message'; message: WeeklyPlanningMessage }\n  | { type: 'set_last_assistant_message'; message: string };`,
  `  | { type: 'append_message'; message: WeeklyPlanningMessage }\n  | { type: 'set_intake_state'; state: PlanningIntakeState | null }\n  | { type: 'clear_conversation' }\n  | { type: 'set_last_assistant_message'; message: string };`,
);

replaceOnce(
  'src/features/weeklyPlanning/weeklyPlanningReducer.ts',
  `    case 'set_last_assistant_message':`,
  `    case 'set_intake_state':\n      return withUpdatedAt({\n        ...state,\n        intakeState: action.state ?? undefined,\n      });\n\n    case 'clear_conversation':\n      return withUpdatedAt({\n        ...state,\n        mode: state.draftBlocks.length > 0 ? 'awaiting_approval' : 'idle',\n        messages: [],\n        intakeState: undefined,\n        lastAssistantMessage: undefined,\n      });\n\n    case 'set_last_assistant_message':`,
);

replaceOnce(
  'src/features/weeklyPlanning/weeklyPlanningStorage.ts',
  `export function saveWeeklyPlanningState(userId: string, state: PlanningState): void {`,
  `function serializableIntakeState(\n  intakeState: PlanningState['intakeState'],\n): PlanningState['intakeState'] {\n  if (!intakeState) return undefined;\n  const { assumptionProposalRecords: _sessionOnlyRecords, ...serializable } = intakeState;\n  return serializable;\n}\n\nexport function saveWeeklyPlanningState(userId: string, state: PlanningState): void {`,
);

replaceOnce(
  'src/features/weeklyPlanning/weeklyPlanningStorage.ts',
  `  const serializableState: PlanningState = {\n    ...state,\n    draftBlocks: state.draftBlocks.filter((block) => block.status === 'draft'),\n  };`,
  `  const serializableState: PlanningState = {\n    ...state,\n    draftBlocks: state.draftBlocks.filter((block) => block.status === 'draft'),\n    intakeState: serializableIntakeState(state.intakeState),\n  };`,
);

replaceOnce(
  'src/features/weeklyPlanning/weeklyPlanningStorage.ts',
  `    if (serializableState.draftBlocks.length === 0) {\n      window.localStorage.removeItem(key);\n      return;\n    }`,
  `    if (\n      serializableState.draftBlocks.length === 0\n      && serializableState.messages.length === 0\n      && !serializableState.intakeState\n    ) {\n      window.localStorage.removeItem(key);\n      return;\n    }`,
);

create(
  'src/components/WeeklyPlanningConversation.tsx',
  `import type { WeeklyPlanningMessage } from '../features/weeklyPlanning/types';\n\ninterface WeeklyPlanningConversationProps {\n  messages: readonly WeeklyPlanningMessage[];\n  isAnalyzing: boolean;\n}\n\nexport function WeeklyPlanningConversation({\n  messages,\n  isAnalyzing,\n}: WeeklyPlanningConversationProps) {\n  if (messages.length === 0 && !isAnalyzing) return null;\n\n  return (\n    <div className="weekly-planning-chat-log" aria-label="週間計画の会話履歴">\n      {messages.map((message) => (\n        <div\n          className={\`weekly-planning-chat-message weekly-planning-chat-message--\${message.role}\`}\n          key={message.id}\n        >\n          <strong>{message.role === 'user' ? 'あなた' : 'アプリ'}</strong>\n          <p>{message.content}</p>\n        </div>\n      ))}\n      {isAnalyzing ? (\n        <div\n          className="weekly-planning-chat-message weekly-planning-chat-message--assistant weekly-planning-chat-message--typing"\n          role="status"\n          aria-label="アプリが回答を作成中"\n        >\n          <strong>アプリ</strong>\n          <span className="weekly-planning-typing-indicator" aria-hidden="true">\n            <span />\n            <span />\n            <span />\n          </span>\n        </div>\n      ) : null}\n    </div>\n  );\n}`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `import { PlanFieldsEditor } from './PlanFieldsEditor';`,
  `import { PlanFieldsEditor } from './PlanFieldsEditor';\nimport { WeeklyPlanningConversation } from './WeeklyPlanningConversation';`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];\n  onCreateWeeklyDraftBlocks?: (blocks: WeeklyPlanDraftBlock[]) => void;`,
  `  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];\n  weeklyPlanningMessages?: WeeklyPlanningMessage[];\n  weeklyPlanningIntakeState?: PlanningIntakeState | null;\n  onAppendWeeklyPlanningMessage?: (message: WeeklyPlanningMessage) => void;\n  onSetWeeklyPlanningIntakeState?: (state: PlanningIntakeState | null) => void;\n  onClearWeeklyPlanningConversation?: () => void;\n  onCreateWeeklyDraftBlocks?: (blocks: WeeklyPlanDraftBlock[]) => void;`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  weeklyDraftBlocks = [],\n  onCreateWeeklyDraftBlocks,`,
  `  weeklyDraftBlocks = [],\n  weeklyPlanningMessages: persistedWeeklyPlanningMessages,\n  weeklyPlanningIntakeState: persistedWeeklyPlanningIntakeState,\n  onAppendWeeklyPlanningMessage,\n  onSetWeeklyPlanningIntakeState,\n  onClearWeeklyPlanningConversation,\n  onCreateWeeklyDraftBlocks,`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  const [weeklyPlanningMessages, setWeeklyPlanningMessages] = useState<\n    WeeklyPlanningMessage[]\n  >([]);\n  const [weeklyPlanningIntakeState, setWeeklyPlanningIntakeState] =\n    useState<PlanningIntakeState | null>(null);`,
  `  const [localWeeklyPlanningMessages, setLocalWeeklyPlanningMessages] = useState<\n    WeeklyPlanningMessage[]\n  >([]);\n  const [localWeeklyPlanningIntakeState, setLocalWeeklyPlanningIntakeState] =\n    useState<PlanningIntakeState | null>(null);\n  const weeklyPlanningMessages = persistedWeeklyPlanningMessages\n    ?? localWeeklyPlanningMessages;\n  const weeklyPlanningIntakeState = persistedWeeklyPlanningIntakeState === undefined\n    ? localWeeklyPlanningIntakeState\n    : persistedWeeklyPlanningIntakeState;`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  function appendWeeklyPlanningMessage(\n    role: WeeklyPlanningMessage['role'],\n    content: string,\n  ) {\n    setWeeklyPlanningMessages((current) => [\n      ...current,\n      createWeeklyPlanningMessage(role, content),\n    ].slice(-24));\n  }`,
  `  function appendWeeklyPlanningMessage(\n    role: WeeklyPlanningMessage['role'],\n    content: string,\n  ) {\n    const message = createWeeklyPlanningMessage(role, content);\n    if (onAppendWeeklyPlanningMessage) {\n      onAppendWeeklyPlanningMessage(message);\n      return;\n    }\n    setLocalWeeklyPlanningMessages((current) => [...current, message]);\n  }\n\n  function storeWeeklyPlanningIntakeState(state: PlanningIntakeState | null) {\n    if (onSetWeeklyPlanningIntakeState) {\n      onSetWeeklyPlanningIntakeState(state);\n      return;\n    }\n    setLocalWeeklyPlanningIntakeState(state);\n  }\n\n  function clearWeeklyPlanningConversationState() {\n    if (onClearWeeklyPlanningConversation) {\n      onClearWeeklyPlanningConversation();\n      return;\n    }\n    setLocalWeeklyPlanningMessages([]);\n    setLocalWeeklyPlanningIntakeState(null);\n  }`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  function resetWeeklyPlanningSession() {\n    setWeeklyPlanningIntakeState(null);\n    setWeeklyPlanningPreviewBlocks([]);\n    setWeeklyPlanningPreviewCandidates([]);\n    setWeeklyPlanningMessages([]);`,
  `  function resetWeeklyPlanningSession() {\n    clearWeeklyPlanningConversationState();\n    setWeeklyPlanningPreviewBlocks([]);\n    setWeeklyPlanningPreviewCandidates([]);`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `  function renderWeeklyPlanningHistory() {\n    if (weeklyPlanningMessages.length === 0) {\n      return null;\n    }\n\n    return (\n      <div className="weekly-planning-chat-log" aria-label="週間計画の会話履歴">\n        {weeklyPlanningMessages.map((message) => (\n          <div\n            className={\`weekly-planning-chat-message weekly-planning-chat-message--\${message.role}\`}\n            key={message.id}\n          >\n            <strong>{message.role === 'user' ? 'あなた' : 'アプリ'}</strong>\n            <p>{message.content}</p>\n          </div>\n        ))}\n      </div>\n    );\n  }`,
  `  function renderWeeklyPlanningHistory() {\n    return (\n      <WeeklyPlanningConversation\n        messages={weeklyPlanningMessages}\n        isAnalyzing={isAnalyzing}\n      />\n    );\n  }`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `    appendWeeklyPlanningMessage('user', trimmedText);\n    setIsAnalyzing(true);`,
  `    appendWeeklyPlanningMessage('user', trimmedText);\n    setText('');\n    setError('');\n    setStatus('');\n    setIsAnalyzing(true);`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `      setWeeklyPlanningIntakeState(pipelineOutput.state);`,
  `      storeWeeklyPlanningIntakeState(pipelineOutput.state);`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `      setError('');\n      setStatus(message);\n      appendWeeklyPlanningMessage('assistant', message);`,
  `      setError('');\n      setStatus('');\n      appendWeeklyPlanningMessage('assistant', message);`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `          userId,\n})\n        : pipelineOutput.behaviorDialogue.message;`,
  `          userId,\n          existingPlans: plans,\n})\n        : pipelineOutput.behaviorDialogue.message;`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `            setWeeklyPlanningIntakeState(null);\n            setError('');`,
  `            setError('');`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `            setWeeklyPlanningIntakeState(null);\n            setWeeklyPlanningPreviewBlocks([]);`,
  `            setWeeklyPlanningPreviewBlocks([]);`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `          {hasLocalWeeklyPlanningPreview ? (`,
  `          {hasLocalWeeklyPlanningPreview && !isAnalyzing ? (`,
);

replaceOnce(
  'src/components/NaturalLanguageAssistant.tsx',
  `          <label className="field field-full">\n            <span>週間計画にしたいこと</span>\n            <textarea\n              value={text}\n              onChange={(event) => setText(event.target.value)}\n              rows={4}\n              placeholder="例: 来週、計算理論と英語を少しずつ進めたい"\n            />\n            <small className="detail-note">\n              条件確認のあと、「この条件で作成」または「配置できる分だけでいい」でのみ仮予定を作成します。\n            </small>\n          </label>\n\n          <div className="row-actions">\n            <button\n              className="primary-button"\n              onClick={() => void handleCreateWeeklyDrafts()}\n              type="button"\n              disabled={isAnalyzing || !canCreateWeeklyDraft}\n            >\n              {isAnalyzing ? '送信中...' : '送信'}\n            </button>\n            {weeklyPlanningMessages.length > 0 ? (\n              <button\n                className="ghost-button"\n                onClick={clearWeeklyPlanningDrafts}\n                type="button"\n              >\n                履歴をクリア\n              </button>\n            ) : null}\n          </div>`,
  `          {!isAnalyzing ? (\n            <>\n              <label className="field field-full">\n                <span>週間計画にしたいこと</span>\n                <textarea\n                  value={text}\n                  onChange={(event) => setText(event.target.value)}\n                  rows={4}\n                  placeholder="例: 来週、計算理論と英語を少しずつ進めたい"\n                />\n                <small className="detail-note">\n                  条件確認のあと、「この条件で作成」または「配置できる分だけでいい」でのみ仮予定を作成します。\n                </small>\n              </label>\n\n              <div className="row-actions">\n                <button\n                  className="primary-button"\n                  onClick={() => void handleCreateWeeklyDrafts()}\n                  type="button"\n                  disabled={!canCreateWeeklyDraft}\n                >\n                  送信\n                </button>\n                {weeklyPlanningMessages.length > 0 ? (\n                  <button\n                    className="ghost-button"\n                    onClick={resetWeeklyPlanningSession}\n                    type="button"\n                  >\n                    履歴をクリア\n                  </button>\n                ) : null}\n              </div>\n            </>\n          ) : null}`,
);

replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';`,
  `import type { PlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeTypes';\nimport type {\n  WeeklyPlanDraftBlock,\n  WeeklyPlanningMessage,\n} from '../features/weeklyPlanning/types';`,
);

replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];\n  onCreateWeeklyDraftBlocks?: (blocks: WeeklyPlanDraftBlock[]) => void;`,
  `  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];\n  weeklyPlanningMessages?: WeeklyPlanningMessage[];\n  weeklyPlanningIntakeState?: PlanningIntakeState | null;\n  onAppendWeeklyPlanningMessage?: (message: WeeklyPlanningMessage) => void;\n  onSetWeeklyPlanningIntakeState?: (state: PlanningIntakeState | null) => void;\n  onClearWeeklyPlanningConversation?: () => void;\n  onCreateWeeklyDraftBlocks?: (blocks: WeeklyPlanDraftBlock[]) => void;`,
);

replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `  weeklyDraftBlocks = [],\n  onCreateWeeklyDraftBlocks,`,
  `  weeklyDraftBlocks = [],\n  weeklyPlanningMessages = [],\n  weeklyPlanningIntakeState = null,\n  onAppendWeeklyPlanningMessage,\n  onSetWeeklyPlanningIntakeState,\n  onClearWeeklyPlanningConversation,\n  onCreateWeeklyDraftBlocks,`,
);

replaceOnce(
  'src/components/QuickEntryModal.tsx',
  `                weeklyDraftBlocks={weeklyDraftBlocks}\n                onCreateWeeklyDraftBlocks={onCreateWeeklyDraftBlocks}`,
  `                weeklyDraftBlocks={weeklyDraftBlocks}\n                weeklyPlanningMessages={weeklyPlanningMessages}\n                weeklyPlanningIntakeState={weeklyPlanningIntakeState}\n                onAppendWeeklyPlanningMessage={onAppendWeeklyPlanningMessage}\n                onSetWeeklyPlanningIntakeState={onSetWeeklyPlanningIntakeState}\n                onClearWeeklyPlanningConversation={onClearWeeklyPlanningConversation}\n                onCreateWeeklyDraftBlocks={onCreateWeeklyDraftBlocks}`,
);

replaceOnce(
  'src/App.tsx',
  `             weeklyDraftBlocks={pendingWeeklyDraftBlocks}\n             onCreateWeeklyDraftBlocks={(blocks) => dispatchPlanningAction({ type: 'add_draft_blocks', blocks })}`,
  `             weeklyDraftBlocks={pendingWeeklyDraftBlocks}\n             weeklyPlanningMessages={planningState.messages}\n             weeklyPlanningIntakeState={planningState.intakeState ?? null}\n             onAppendWeeklyPlanningMessage={(message) =>\n               dispatchPlanningAction({ type: 'append_message', message })\n             }\n             onSetWeeklyPlanningIntakeState={(state) =>\n               dispatchPlanningAction({ type: 'set_intake_state', state })\n             }\n             onClearWeeklyPlanningConversation={() =>\n               dispatchPlanningAction({ type: 'clear_conversation' })\n             }\n             onCreateWeeklyDraftBlocks={(blocks) => dispatchPlanningAction({ type: 'add_draft_blocks', blocks })}`,
);

appendOnce(
  'src/styles/quick-entry.css',
  '.weekly-planning-typing-indicator',
  `.weekly-planning-chat-message--typing {\n  min-width: 84px;\n}\n\n.weekly-planning-typing-indicator {\n  display: inline-flex;\n  gap: 5px;\n  align-items: center;\n  min-height: 20px;\n}\n\n.weekly-planning-typing-indicator span {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: var(--text-muted);\n  animation: weekly-planning-typing-bounce 1.1s infinite ease-in-out;\n}\n\n.weekly-planning-typing-indicator span:nth-child(2) {\n  animation-delay: 0.14s;\n}\n\n.weekly-planning-typing-indicator span:nth-child(3) {\n  animation-delay: 0.28s;\n}\n\n@keyframes weekly-planning-typing-bounce {\n  0%, 60%, 100% {\n    opacity: 0.42;\n    transform: translateY(0);\n  }\n  30% {\n    opacity: 1;\n    transform: translateY(-4px);\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .weekly-planning-typing-indicator span {\n    animation: none;\n  }\n}`,
);

create(
  'src/features/weeklyPlanning/intake/weeklyPlanningScopeEnrichment.test.ts',
  `import { describe, expect, it } from 'vitest';\nimport type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';\nimport { validateInterpretedCandidates } from './weeklyPlanningCandidateValidator';\nimport type { InterpretedCommandCandidate, InterpreterStateSummary } from './weeklyPlanningInterpreterTypes';\n\nfunction candidate(command: ParsedWeeklyPlanningCommand): InterpretedCommandCandidate {\n  return { command, origin: 'ai_interpreter', needsConfirmation: false };\n}\n\nconst scopeCommand: ParsedWeeklyPlanningCommand = {\n  type: 'set_exam_scope',\n  scope: {\n    examType: '院試',\n    fields: ['OSnetwork'],\n    totalFields: 1,\n    totalYears: 7,\n    yearRange: { startYear: 2025, endYear: 2019, sourceText: '2025~2019' },\n    unitModel: 'year_field_chunk',\n    rawText: ['OSnetwork 2025~2019'],\n  },\n  sourceText: 'OSnetworkが2025~2019の7年分ある',\n  confidence: 'high',\n};\n\ndescribe('weekly planning exam scope enrichment', () => {\n  it('accepts fields that enrich a deterministic year-only scope', () => {\n    const summary: InterpreterStateSummary = {\n      knownFields: [],\n      examScopeSummary: {\n        fields: [],\n        yearRange: { startYear: 2025, endYear: 2019 },\n      },\n      confirmedSlots: ['year_range'],\n    };\n\n    const result = validateInterpretedCandidates([candidate(scopeCommand)], summary);\n    expect(result.accepted).toEqual([scopeCommand]);\n    expect(result.rejected).toEqual([]);\n  });\n\n  it('rejects a candidate that changes confirmed fields while adding a year range', () => {\n    const command = {\n      ...scopeCommand,\n      scope: { ...scopeCommand.scope, fields: ['英語'] },\n    } satisfies ParsedWeeklyPlanningCommand;\n    const summary: InterpreterStateSummary = {\n      knownFields: ['OSnetwork'],\n      examScopeSummary: { fields: ['OSnetwork'] },\n      confirmedSlots: ['exam_scope'],\n    };\n\n    const result = validateInterpretedCandidates([candidate(command)], summary);\n    expect(result.accepted).toEqual([]);\n    expect(result.rejected).toEqual([\n      expect.objectContaining({ reason: 'confirmed-slot-overwrite' }),\n    ]);\n  });\n});`,
);

create(
  'src/features/weeklyPlanning/intake/weeklyPlanningSingleFieldPriority.test.ts',
  `import { describe, expect, it } from 'vitest';\nimport { finalizeState } from './weeklyPlanningMissingStatus';\nimport type { PlanningIntakeState } from './weeklyPlanningIntakeTypes';\n\nfunction stateWithFields(fields: string[]): PlanningIntakeState {\n  return {\n    status: 'needs_priority_policy',\n    intent: 'exam_prep_planning',\n    examPrepScope: {\n      examType: '院試',\n      fields,\n      yearRange: { startYear: 2025, endYear: 2019, sourceText: '2025~2019' },\n      unitModel: 'year_field_chunk',\n      rawText: ['scope'],\n    },\n    tasks: [],\n    progress: [],\n    unitRates: [{\n      unit: 'year_field_chunk',\n      minutesPerUnit: 180,\n      source: 'user',\n      rawText: '3時間',\n    }],\n    constraints: [],\n    priorityPolicy: { kind: 'unknown' },\n    missing: [],\n    assumptions: [],\n    uncertainties: [],\n    questions: [],\n    shouldCreateDraft: false,\n    shouldSavePlan: false,\n    sourceTurns: [],\n  };\n}\n\ndescribe('weekly planning single-field priority', () => {\n  it('selects the only field without asking a priority question', () => {\n    const state = finalizeState(stateWithFields(['OSnetwork']));\n    expect(state.priorityPolicy).toEqual({ kind: 'field_first', order: ['OSnetwork'] });\n    expect(state.missing).not.toContain('priority_policy');\n    expect(state.missing).not.toContain('next_field_after_math');\n    expect(state.questions.join(' ')).not.toContain('優先');\n  });\n\n  it('keeps priority confirmation for multiple fields', () => {\n    const state = finalizeState(stateWithFields(['数学', '英語']));\n    expect(state.missing).toContain('priority_policy');\n    expect(state.questions.join(' ')).toContain('優先');\n  });\n});`,
);

create(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningKnownFixedEvents.test.ts',
  `import { describe, expect, it } from 'vitest';\nimport type { Plan } from '../../../types/domain';\nimport { fallbackQuestionForSlot } from '../intake/weeklyPlanningQuestionSlots';\nimport { createKnownFixedEventSummaries } from './weeklyPlanningKnownFixedEvents';\n\nfunction plan(id: string, date: string, startTime: string, endTime: string, title: string): Plan {\n  return {\n    id,\n    userId: 'user',\n    date,\n    startTime,\n    endTime,\n    title,\n    subject: '',\n    type: 'other',\n    memo: '',\n    createdAt: '2026-07-16T00:00:00.000Z',\n    updatedAt: '2026-07-16T00:00:00.000Z',\n  } as Plan;\n}\n\ndescribe('known fixed event summaries', () => {\n  it('uses only registered plans inside the planning range', () => {\n    const summaries = createKnownFixedEventSummaries([\n      plan('1', '2026-07-16', '10:00', '11:00', '授業'),\n      plan('2', '2026-07-20', '12:00', '13:00', '範囲外'),\n    ], {\n      confidence: 'explicit',\n      startDateTime: '2026-07-16T00:00:00',\n      endDateTime: '2026-07-19T23:59:59',\n    });\n\n    expect(summaries).toEqual(['7/16 10:00〜11:00「授業」']);\n  });\n\n  it('asks only for additional events and does not use personal examples', () => {\n    const question = fallbackQuestionForSlot('fixed_events', {\n      knownFixedEventSummaries: ['7/16 10:00〜11:00「授業」'],\n    });\n    expect(question).toContain('登録済みの予定は');\n    expect(question).toContain('これ以外に');\n    expect(question).not.toContain('通院');\n  });\n});`,
);

create(
  'src/features/weeklyPlanning/weeklyPlanningConversationPersistence.test.ts',
  `import { beforeEach, describe, expect, it } from 'vitest';\nimport { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';\nimport { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';\nimport { loadWeeklyPlanningState, saveWeeklyPlanningState } from './weeklyPlanningStorage';\n\ndescribe('weekly planning conversation persistence', () => {\n  beforeEach(() => window.localStorage.clear());\n\n  it('persists messages and intake state even when no draft exists', () => {\n    const weekStartDate = '2026-07-13';\n    const initial = createInitialPlanningState(weekStartDate);\n    const withMessage = weeklyPlanningReducer(initial, {\n      type: 'append_message',\n      message: {\n        id: 'message-1',\n        role: 'user',\n        content: '来週の予定を作りたい',\n        createdAt: '2026-07-16T00:00:00.000Z',\n      },\n    });\n    const intakeState = {\n      ...createInitialPlanningIntakeState(),\n      sourceTurns: ['来週の予定を作りたい'],\n      assumptionProposalRecords: [{ proposalId: 'session-only' }] as never,\n    };\n    const withIntake = weeklyPlanningReducer(withMessage, {\n      type: 'set_intake_state',\n      state: intakeState,\n    });\n\n    saveWeeklyPlanningState('user', withIntake);\n    const loaded = loadWeeklyPlanningState('user', weekStartDate);\n    expect(loaded.messages).toEqual(withIntake.messages);\n    expect(loaded.intakeState?.sourceTurns).toEqual(['来週の予定を作りたい']);\n    expect(loaded.intakeState?.assumptionProposalRecords).toBeUndefined();\n  });\n\n  it('removes the stored conversation only after clear_conversation', () => {\n    const weekStartDate = '2026-07-13';\n    const withMessage = weeklyPlanningReducer(createInitialPlanningState(weekStartDate), {\n      type: 'append_message',\n      message: {\n        id: 'message-1',\n        role: 'user',\n        content: '予定',\n        createdAt: '2026-07-16T00:00:00.000Z',\n      },\n    });\n    saveWeeklyPlanningState('user', withMessage);\n    expect(loadWeeklyPlanningState('user', weekStartDate).messages).toHaveLength(1);\n\n    const cleared = weeklyPlanningReducer(withMessage, { type: 'clear_conversation' });\n    saveWeeklyPlanningState('user', cleared);\n    expect(loadWeeklyPlanningState('user', weekStartDate).messages).toEqual([]);\n  });\n});`,
);

create(
  'src/components/WeeklyPlanningConversation.test.tsx',
  `import { renderToStaticMarkup } from 'react-dom/server';\nimport { describe, expect, it } from 'vitest';\nimport { WeeklyPlanningConversation } from './WeeklyPlanningConversation';\n\ndescribe('WeeklyPlanningConversation', () => {\n  it('shows a typing indicator without duplicating an input composer', () => {\n    const html = renderToStaticMarkup(\n      <WeeklyPlanningConversation\n        messages={[{\n          id: 'user-1',\n          role: 'user',\n          content: '3時間ぐらいかな',\n          createdAt: '2026-07-16T00:00:00.000Z',\n        }]}\n        isAnalyzing\n      />,\n    );\n    expect(html).toContain('3時間ぐらいかな');\n    expect(html).toContain('weekly-planning-typing-indicator');\n    expect(html).not.toContain('textarea');\n  });\n});`,
);

console.log('weekly planning conversation hardening changes applied');
