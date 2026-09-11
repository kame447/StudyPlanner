import { mkdirSync, writeFileSync } from 'node:fs';
import { vi } from 'vitest';
import type { StudyMaterial } from '../../../types/domain';
import {
  createUserConfirmedPlanningContextRecordV1,
  exportUserPlanningContextSnapshotV1,
  hydrateUserPlanningContextSnapshotV1,
  resetUserPlanningContextRuntimeForTestV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import {
  replaceWithUserConfirmedContextRecordV1,
} from '../../userPlanningContext/userPlanningContextRepository';
import {
  interpretUserPlanningContextNaturalLanguageV2,
} from '../../userPlanningContext/userPlanningContextNaturalLanguageV2';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  getWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from '../application/weeklyPlanningStableV5RuntimeSession';
import { weeklyPlanningTurnRuntimeGateway } from '../application/weeklyPlanningTurnRuntimeGateway';
import { weeklyPlanningTurnStagingLifecycle } from '../application/weeklyPlanningTurnSideEffects';
import {
  submitWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnApplicationServices,
} from '../application/weeklyPlanningTurnApplication';
import { clearWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutor';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { takeWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  createAiWeeklyPlanningStableV5DialogueRenderer,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from '../dialogue/weeklyPlanningStableV5AiDialogueRenderer';
import type { AiConfig } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticTypesV5';

export const ISSUE152_REFERENCE_DATE = '2026-08-17';
export const ISSUE152_OUTPUT_DIR = process.env.WEEKLY_PLANNING_ISSUE152_OUTPUT_DIR
  ?? 'artifacts/issue152-adversarial-real-api';
export const ISSUE152_TIMEOUT_MS = Number(
  process.env.WEEKLY_PLANNING_ISSUE152_TIMEOUT_MS ?? '300000',
);
export const ISSUE152_CRITICAL_REPETITIONS = Number(
  process.env.WEEKLY_PLANNING_ISSUE152_CRITICAL_REPETITIONS ?? '2',
);

export interface Issue152ObservedTurn {
  conversationId: string;
  userText: string;
  assistantText: string;
  mode: PlanningState['mode'];
  draftCount: number;
  previewCount: number;
  graphRevision: number;
  graph: WeeklyPlanningFactGraphV5 | null;
  activeProjection: Record<string, unknown>;
  route: string | null;
  lastQuestionContext: unknown;
  renderer: WeeklyPlanningTurnExecutionResult['dialogueRendererTrace'] | null;
  responseSource: string | null;
  failureCode: string | null;
  validationErrors: string[];
  canaryHits: Record<string, boolean>;
  providerCallCount: number;
}

export interface Issue152ConversationParams {
  conversationId: string;
  ownerId?: string;
  canary?: string;
  turns: string[];
  supplementalContexts?: Array<string | undefined>;
  studyMaterials?: StudyMaterial[];
  resetUserContext?: boolean;
  fakeProvider?: boolean;
  providerResponse?: (input: {
    purpose: string | undefined;
    messages: Array<{ role: string; content: string }>;
  }) => string;
}

export interface Issue152ConversationResult {
  turns: Issue152ObservedTurn[];
  providerCallCount: number;
}

function createStore(initialState: PlanningState) {
  let state = structuredClone(initialState);
  return {
    getState: () => state,
    dispatch(action: WeeklyPlanningAction): PlanningState {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function countByKind(active: ReturnType<typeof createWeeklyPlanningActiveSchedulerGraphViewV5>) {
  return {
    planningWindows: active.planningWindows.length,
    tasks: active.tasks.length,
    components: active.components.length,
    workloads: active.workloads.length,
    effortEstimates: active.effortEstimates.length,
    temporalConstraints: active.temporalConstraints.length,
    taskDateRules: active.taskDateRules.length,
    recurrence: active.recurrences.length,
    availabilityDeclarations: active.availabilityDeclarations.length,
    relations: active.relations.length,
    constraintSourceRequests: active.constraintSourceRequests.length,
    uncertainties: active.uncertainties.length,
  };
}

function activeProjection(
  graph: WeeklyPlanningFactGraphV5 | null,
  state: PlanningState,
): Record<string, unknown> {
  const active = graph ? createWeeklyPlanningActiveSchedulerGraphViewV5(graph) : null;
  return {
    route: state.intakeState?.lastQuestionContext?.targetSlot ?? null,
    factsByKind: active ? countByKind(active) : null,
    constraints: active?.temporalConstraints.map((fact) => ({
      kind: fact.kind,
      level: fact.constraintLevel,
      startTime: fact.startTime,
      endTime: fact.endTime,
      sourceText: fact.source.sourceText,
    })) ?? [],
    previewEligible: (state.previewCandidates?.length ?? 0) > 0,
    previewCount: state.previewCandidates?.length ?? 0,
    draftCount: state.draftBlocks.length,
    mode: state.mode,
  };
}

function hasCanary(value: unknown, canary: string): boolean {
  try {
    return JSON.stringify(value).includes(canary);
  } catch {
    return false;
  }
}

function canaryHits(params: {
  canary?: string;
  assistantText: string;
  graph: WeeklyPlanningFactGraphV5 | null;
  contextRecords: ReturnType<typeof exportUserPlanningContextSnapshotV1>['records'];
  renderer: WeeklyPlanningTurnExecutionResult['dialogueRendererTrace'] | null;
}): Record<string, boolean> {
  if (!params.canary) return {};
  return {
    assistantText: params.assistantText.includes(params.canary),
    graph: hasCanary(params.graph, params.canary),
    context: hasCanary(params.contextRecords, params.canary),
    renderedText: params.renderer?.response.renderedText?.includes(params.canary) ?? false,
  };
}

function evidenceText(text: string): string {
  const candidates = [
    '数学を20問',
    '数学を20ページ',
    '数学を30分',
    '数学20問',
    '英語を10ページ',
    '英語を20ページ',
    '画像から学習計画',
  ];
  return candidates.find((candidate) => text.includes(candidate)) ?? text.slice(0, 100);
}

function semanticDocument(text: string): WeeklyPlanningSemanticDocumentV5 {
  const title = text.includes('英語') ? '英語' : '数学';
  const amount = text.includes('10ページ') ? 10 : text.includes('30分') ? 30 : 20;
  const unitCode = text.includes('ページ') ? 'page' : text.includes('分') ? 'minute' : 'problem';
  const unitLabel = unitCode === 'page' ? 'ページ' : unitCode === 'minute' ? '分' : '問';
  const sourceText = evidenceText(text);
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 'fixture-task',
      category: 'study',
      title,
      study: { purpose: 'self_study', contextLabel: title, components: [] },
      workloads: [{
        localId: 'fixture-workload',
        quantityRole: 'target',
        amount,
        unitCode,
        unitLabel,
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText,
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function rendererResponse(messages: Array<{ role: string; content: string }>): string {
  const prompt = messages[messages.length - 1]?.content ?? '';
  const actionIdMatch = prompt.match(/stable_v5:[^"\\s]+/);
  const actionId = actionIdMatch?.[0] ?? 'stable_v5:fixture:status';
  const actionKind = prompt.includes('preview_ready') ? 'preview_ready' : 'question';
  const questionCodeMatch = prompt.match(/missing_[a-z_]+/);
  return JSON.stringify({
    actionId,
    actionKind,
    questionCode: questionCodeMatch?.[0] ?? null,
    groundingAcknowledgement: null,
    text: 'fixture response',
  });
}

export function defaultFixtureProviderResponse(input: {
  purpose: string | undefined;
  messages: Array<{ role: string; content: string }>;
}): string {
  if (input.purpose === 'weekly_planning_renderer') return rendererResponse(input.messages);
  if (input.purpose === 'weekly_planning_semantic_normalizer') {
    const userMessages = input.messages.filter((message) => message.role === 'user');
    const last = userMessages[userMessages.length - 1]?.content ?? '';
    return JSON.stringify(semanticDocument(last));
  }
  return JSON.stringify({
    targetDomain: 'user_context',
    kind: 'learning_preference',
    label: 'fixture preference',
    value: '15分',
    dateExpression: null,
    displayText: 'fixture preference is 15 minutes.',
    reason: 'fixture',
  });
}

export function installIssue152ScriptedProvider(
  responseFactory: (input: {
    purpose: string | undefined;
    messages: Array<{ role: string; content: string }>;
  }) => string = defaultFixtureProviderResponse,
): { calls: Array<{ purpose: string | undefined; messages: Array<{ role: string; content: string }> }>; restore: () => void } {
  const calls: Array<{ purpose: string | undefined; messages: Array<{ role: string; content: string }> }> = [];
  vi.stubEnv('VITE_AI_PROVIDER', 'openai');
  vi.stubEnv('VITE_AI_BASE_URL', 'https://issue152.fixture.test/v1');
  vi.stubEnv('VITE_AI_MODEL', 'issue152-fixture');
  vi.stubEnv('VITE_AI_API_KEY', 'issue152-fixture-key');
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      messages?: Array<{ role: string; content: string }>;
      purpose?: string;
      response_format?: { json_schema?: { name?: string } };
    };
    const messages = body.messages ?? [];
    const schemaName = body.response_format?.json_schema?.name ?? '';
    const purpose = body.purpose
      ?? (schemaName.includes('dialogue') ? 'weekly_planning_renderer' : undefined)
      ?? (schemaName.includes('weekly_planning_semantic') ? 'weekly_planning_semantic_normalizer' : undefined);
    const entry = { purpose, messages };
    calls.push(entry);
    const content = responseFactory(entry);
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    restore: () => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    },
  };
}

export async function runIssue152Conversation(
  params: Issue152ConversationParams,
): Promise<Issue152ConversationResult> {
  const ownerId = params.ownerId ?? `issue152-b-${params.conversationId}`;
  const fake = params.fakeProvider
    ? installIssue152ScriptedProvider(params.providerResponse)
    : null;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  clearWeeklyPlanningSessionRuntime();
  if (params.resetUserContext !== false) resetUserPlanningContextRuntimeForTestV1();
  bindWeeklyPlanningStableV5RuntimeSessionScope({
    ownerId,
    weekStartDate: ISSUE152_REFERENCE_DATE,
    conversationId: params.conversationId,
  });

  const store = createStore(createInitialPlanningState(ISSUE152_REFERENCE_DATE));
  const session = createWeeklyPlanningControllerSession(
    ownerId,
    ISSUE152_REFERENCE_DATE,
    params.conversationId,
  );
  let capturedResult: WeeklyPlanningTurnExecutionResult | null = null;
  let requestId: string | null = null;
  const services: WeeklyPlanningTurnApplicationServices = {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    runtimeGateway: {
      async execute(runtimeParams) {
        requestId = runtimeParams.pending.requestId;
        capturedResult = await weeklyPlanningTurnRuntimeGateway.execute(runtimeParams);
        return capturedResult;
      },
    },
    stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
    outcomeLifecycle: {
      committed: () => undefined,
      discarded: () => undefined,
      failed: () => undefined,
    },
  };

  try {
    const turns: Issue152ObservedTurn[] = [];
    for (const [turnIndex, userText] of params.turns.entries()) {
      capturedResult = null;
      requestId = null;
      const submission = await submitWeeklyPlanningApplicationTurn({
        session,
        userId: ownerId,
        ownerId,
        userText,
        supplementalContext: params.supplementalContexts?.[turnIndex] ?? undefined,
        selectedDate: ISSUE152_REFERENCE_DATE,
        plans: [],
        studyMaterials: params.studyMaterials,
        scheduleTemplates: [],
        plannerDataAvailability: createReadyPlannerDataAvailability(ownerId),
        weekStartsOn: 'monday',
        getState: store.getState,
        dispatch: store.dispatch,
      }, services);
      if (!submission.accepted) throw new Error(`Issue #152 planner data was not ready: ${params.conversationId}`);
      if (!capturedResult || !requestId) throw new Error(`Issue #152 runtime result missing: ${params.conversationId}`);
      const result = capturedResult as WeeklyPlanningTurnExecutionResult;
      const traceEvents = takeWeeklyPlanningStableV5DebugTrace(requestId);
      const validationErrors = traceEvents.flatMap((event) => {
        if (event.stage !== 'semantic_validation_result' || typeof event.data !== 'object' || event.data === null) return [];
        const errors = (event.data as { errors?: unknown }).errors;
        return Array.isArray(errors) ? errors.filter((error): error is string => typeof error === 'string') : [];
      });
      const state = store.getState();
      const runtime = getWeeklyPlanningStableV5RuntimeSession(params.conversationId);
      const graph = runtime?.graph ?? result.stableV5Graph ?? null;
      const assistantText = state.lastAssistantMessage ?? result.message;
      const records = exportUserPlanningContextSnapshotV1({
        ownerId,
        currentDate: ISSUE152_REFERENCE_DATE,
      }).records;
      const renderer = result.dialogueRendererTrace ?? null;
      const canary = params.canary ?? userText.match(/CNRY152-B-[A-Z0-9-]+/u)?.[0];
      turns.push({
        conversationId: params.conversationId,
        userText,
        assistantText,
        mode: state.mode,
        draftCount: state.draftBlocks.length,
        previewCount: state.previewCandidates?.length ?? 0,
        graphRevision: runtime?.graph.revision ?? -1,
        graph,
        activeProjection: activeProjection(graph, state),
        route: state.intakeState?.lastQuestionContext?.targetSlot ?? null,
        lastQuestionContext: state.intakeState?.lastQuestionContext ?? null,
        renderer,
        responseSource: result.responseSource ?? null,
        failureCode: result.failure?.code ?? null,
        validationErrors,
        canaryHits: canaryHits({
          canary,
          assistantText,
          graph,
          contextRecords: records,
          renderer,
        }),
        providerCallCount: fake?.calls.length ?? 0,
      });
    }
    return { turns, providerCallCount: fake?.calls.length ?? 0 };
  } finally {
    fake?.restore();
  }
}

export function writeIssue152Observation(name: string, value: unknown): void {
  mkdirSync(ISSUE152_OUTPUT_DIR, { recursive: true });
  writeFileSync(`${ISSUE152_OUTPUT_DIR}/${name}.json`, `${JSON.stringify(value, null, 2)}\n`);
}

export function seedIssue152Context(params: {
  ownerId: string;
  id: string;
  label: string;
  value: string | null;
  sourceText: string;
  origin?: 'user_stated' | 'user_confirmed' | 'system_inferred';
}): void {
  resetUserPlanningContextRuntimeForTestV1();
  hydrateUserPlanningContextSnapshotV1({
    version: 'studyplanner-user-planning-context-v1',
    ownerId: params.ownerId,
    records: [{
      id: params.id,
      ownerId: params.ownerId,
      kind: 'learning_preference',
      label: params.label,
      value: params.value,
      dateExpression: null,
      observedDate: ISSUE152_REFERENCE_DATE,
      resolvedDate: null,
      sourceText: params.sourceText,
      sourceConversationId: 'issue152-seed-conversation',
      sourceTurnId: 'issue152-seed-turn',
      recordedAt: '2026-08-17T00:00:00.000Z',
      status: 'active',
      origin: params.origin ?? 'user_stated',
    }],
    updatedAt: '2026-08-17T00:00:00.000Z',
  });
}

export async function runIssue152SettingsEditFixture(params: {
  canary: string;
  existingValue: string;
  submittedText: string;
}): Promise<{
  interpreted: Awaited<ReturnType<typeof interpretUserPlanningContextNaturalLanguageV2>>;
  saved: ReturnType<typeof exportUserPlanningContextSnapshotV1>['records'][number];
  providerCallCount: number;
}> {
  const ownerId = 'issue152-b-settings-owner';
  const existing = createUserConfirmedPlanningContextRecordV1({
    ownerId,
    kind: 'learning_preference',
    label: '暗記学習',
    value: params.existingValue,
    dateExpression: null,
    currentDate: ISSUE152_REFERENCE_DATE,
    sourceText: `暗記学習: ${params.existingValue}`,
    now: '2026-08-17T00:00:00.000Z',
    existingId: 'issue152-settings-existing',
  });
  const fakeClient: OpenAiCompatibleClient = {
    async createChatCompletion() {
      return JSON.stringify({
        targetDomain: 'user_context',
        kind: 'learning_preference',
        label: '暗記学習',
        value: '15分に分けたい',
        dateExpression: null,
        displayText: '暗記は15分に分けて勉強したい。',
        reason: 'ユーザーが設定編集で明示した継続的な好み',
      });
    },
  };
  const interpreted = await interpretUserPlanningContextNaturalLanguageV2({
    text: params.submittedText,
    existingRecord: existing,
    client: fakeClient,
  });
  const saved = createUserConfirmedPlanningContextRecordV1({
    ownerId,
    kind: interpreted.kind ?? 'learning_preference',
    label: interpreted.label ?? '暗記学習',
    value: interpreted.value,
    dateExpression: interpreted.dateExpression,
    currentDate: ISSUE152_REFERENCE_DATE,
    sourceText: interpreted.displayText,
    now: '2026-08-17T00:00:01.000Z',
    existingId: existing.id,
  });
  const next = replaceWithUserConfirmedContextRecordV1({
    snapshot: {
      version: 'studyplanner-user-planning-context-v1',
      ownerId,
      records: [existing],
      updatedAt: '2026-08-17T00:00:00.000Z',
    },
    record: saved,
    previousRecordId: existing.id,
    now: '2026-08-17T00:00:01.000Z',
  });
  hydrateUserPlanningContextSnapshotV1(next);
  const persisted = exportUserPlanningContextSnapshotV1({
    ownerId,
    currentDate: ISSUE152_REFERENCE_DATE,
  }).records[0];
  if (!persisted) throw new Error('Issue #152 settings fixture did not persist a record');
  return { interpreted, saved: persisted, providerCallCount: 1 };
}

export async function runIssue152RendererFixture(params: {
  canary: string;
  unsafeText: boolean;
}): Promise<{
  result: Awaited<ReturnType<ReturnType<typeof createAiWeeklyPlanningStableV5DialogueRenderer>['render']>>;
  actionKind: string;
  approvalOperations: unknown[];
  providerCallCount: number;
}> {
  const input: WeeklyPlanningStableV5DialogueRenderInput = {
    actionId: 'stable_v5:issue152-b-renderer',
    currentUserMessage: `内容を確認してください ${params.canary}`,
    recentConversation: [],
    planningInformation: {
      tasks: [{ title: '数学' }],
      trustedFacts: [],
      untrustedStoredRows: [{ label: '保存済みラベル', value: params.canary }],
    },
    actionKind: 'status',
    questionCode: null,
    requiredLabels: [],
    fallbackText: '内容を確認しました。',
    previewCount: 0,
  };
  const config: AiConfig = {
    provider: 'openai',
    baseUrl: 'https://issue152.fixture.test/v1',
    model: 'issue152-fixture',
    apiKey: 'issue152-fixture-key',
  };
  let providerCallCount = 0;
  const client: OpenAiCompatibleClient = {
    async createChatCompletion() {
      providerCallCount += 1;
      return JSON.stringify({
        actionId: input.actionId,
        actionKind: input.actionKind,
        questionCode: null,
        groundingAcknowledgement: null,
        text: params.unsafeText ? `保存済みです ${params.canary}` : '内容を確認しました。',
      });
    },
  };
  const result = await createAiWeeklyPlanningStableV5DialogueRenderer(config, client).render(input);
  return {
    result,
    actionKind: input.actionKind,
    approvalOperations: [],
    providerCallCount,
  };
}
