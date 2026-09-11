import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAiConfig } from '../../../lib/aiConfig';
import {
  resetUserPlanningContextRuntimeForTestV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  getWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from '../application/weeklyPlanningStableV5RuntimeSession';
import {
  weeklyPlanningTurnRuntimeGateway,
} from '../application/weeklyPlanningTurnRuntimeGateway';
import {
  weeklyPlanningTurnStagingLifecycle,
} from '../application/weeklyPlanningTurnSideEffects';
import {
  submitWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnApplicationServices,
} from '../application/weeklyPlanningTurnApplication';
import {
  createAiWeeklyPlanningStableV5DialogueRenderer,
} from '../dialogue/weeklyPlanningStableV5AiDialogueRenderer';
import type {
  WeeklyPlanningStableV5DialogueRenderInput,
} from '../dialogue/weeklyPlanningStableV5DialogueContracts';
import { clearWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import {
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import type {
  WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutor';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from '../weeklyPlanningReducer';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR
  ?? 'artifacts/issue156-real-api';
const timeoutMs = Number(process.env.WEEKLY_PLANNING_ISSUE156_TIMEOUT_MS ?? '300000');

interface TurnCapture {
  result: WeeklyPlanningTurnExecutionResult | null;
  requestId: string | null;
}

interface ObservedTurn {
  index: number;
  userText: string;
  assistantText: string;
  requestId: string;
  responseSource: string | null;
  questionContext: unknown;
  graphRevision: number;
  graph: unknown;
  dialogueRendererTrace: unknown;
  debugTrace: unknown[];
}

interface ConversationObservation {
  name: string;
  turns: ObservedTurn[];
  error: string | null;
}

interface RendererMatrixObservation {
  name: string;
  questionCode: string;
  result: unknown;
  input: WeeklyPlanningStableV5DialogueRenderInput;
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

function targetSlot(turn: ObservedTurn | undefined): string | null {
  const value = turn?.questionContext;
  if (
    typeof value === 'object'
    && value !== null
    && 'targetSlot' in value
    && typeof value.targetSlot === 'string'
  ) return value.targetSlot;
  return null;
}

function containsClockAcknowledgement(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  const start = compact.includes('14:30')
    || compact.includes('14時30分')
    || compact.includes('14時半');
  const end = compact.includes('20:00') || compact.includes('20時');
  return start && end;
}

function containsDeadlineAcknowledgement(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  return compact.includes('13:00') || compact.includes('13時');
}

function containsCorrectionAcknowledgement(text: string): boolean {
  return text.includes('12枚') || text.includes('12 枚');
}

async function runConversation(params: {
  name: string;
  ownerId: string;
  conversationId: string;
  turns: string[];
}): Promise<ConversationObservation> {
  const weekStartDate = '2026-08-17';
  const selectedDate = '2026-08-17';

  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  clearWeeklyPlanningSessionRuntime();
  resetUserPlanningContextRuntimeForTestV1();
  bindWeeklyPlanningStableV5RuntimeSessionScope({
    ownerId: params.ownerId,
    weekStartDate,
    conversationId: params.conversationId,
  });

  const store = createStore(createInitialPlanningState(weekStartDate));
  const session = createWeeklyPlanningControllerSession(
    params.ownerId,
    weekStartDate,
    params.conversationId,
  );
  const capture: TurnCapture = { result: null, requestId: null };
  const observed: ObservedTurn[] = [];

  const services: WeeklyPlanningTurnApplicationServices = {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    runtimeGateway: {
      async execute(runtimeParams) {
        capture.requestId = runtimeParams.pending.requestId;
        capture.result = await weeklyPlanningTurnRuntimeGateway.execute(runtimeParams);
        return capture.result;
      },
    },
    stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
    outcomeLifecycle: {
      committed: () => undefined,
      discarded: () => undefined,
      failed: () => undefined,
    },
  };

  let error: string | null = null;
  for (let index = 0; index < params.turns.length; index += 1) {
    capture.result = null;
    capture.requestId = null;
    const userText = params.turns[index];
    try {
      const submission = await submitWeeklyPlanningApplicationTurn({
        session,
        userId: params.ownerId,
        ownerId: params.ownerId,
        plannerDataAvailability: createReadyPlannerDataAvailability(params.ownerId),
        userText,
        selectedDate,
        plans: [],
        scheduleTemplates: [],
        weekStartsOn: 'monday',
        getState: store.getState,
        dispatch: store.dispatch,
      }, services);
      if (!submission.accepted) {
        error = `turn ${index + 1}: submission rejected`;
        break;
      }
      const result = capture.result;
      const requestId = capture.requestId;
      if (result === null || requestId === null) {
        error = `turn ${index + 1}: no runtime result`;
        break;
      }
      const typedResult: WeeklyPlanningTurnExecutionResult = result;
      const typedRequestId: string = requestId;
      if (typedResult.failure) {
        error = `turn ${index + 1}: ${typedResult.failure.code} ${typedResult.failure.traceCode}`;
        break;
      }
      const runtime = getWeeklyPlanningStableV5RuntimeSession(params.conversationId);
      observed.push({
        index: index + 1,
        userText,
        assistantText: store.getState().lastAssistantMessage ?? typedResult.message,
        requestId: typedRequestId,
        responseSource: typedResult.responseSource ?? null,
        questionContext: store.getState().intakeState?.lastQuestionContext ?? null,
        graphRevision: runtime?.graph.revision ?? -1,
        graph: runtime?.graph ?? null,
        dialogueRendererTrace: typedResult.dialogueRendererTrace ?? null,
        debugTrace: takeWeeklyPlanningStableV5DebugTrace(typedRequestId),
      });
    } catch (caught) {
      error = `turn ${index + 1}: ${caught instanceof Error ? caught.message : String(caught)}`;
      break;
    }
  }

  return { name: params.name, turns: observed, error };
}

function matrixInput(params: {
  name: string;
  questionCode: string;
  currentUserMessage: string;
  recentAssistant: string;
  planningInformation: Record<string, unknown>;
  questionTarget?: WeeklyPlanningStableV5DialogueRenderInput['questionTarget'];
  requiredLabels?: string[];
  fallbackText: string;
}): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: `issue156:${params.name}:${params.questionCode}`,
    currentUserMessage: params.currentUserMessage,
    recentConversation: [
      { role: 'assistant', content: params.recentAssistant },
      { role: 'user', content: params.currentUserMessage },
    ],
    planningInformation: params.planningInformation,
    actionKind: 'question',
    questionCode: params.questionCode,
    questionTarget: params.questionTarget ?? null,
    questionIntent: null,
    previewPromotionControlLabel: null,
    requiredLabels: params.requiredLabels ?? [],
    fallbackText: params.fallbackText,
    previewCount: 0,
  };
}

async function runRendererMatrix(): Promise<RendererMatrixObservation[]> {
  const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(getAiConfig());
  const task = { id: 'task-1', category: 'study', title: 'レポート' };
  const workload = {
    id: 'workload-1',
    taskId: 'task-1',
    componentId: null,
    quantityRole: 'unknown',
    amount: 20,
    unitCode: 'page',
    unitLabel: 'ページ',
  };
  const availabilityWithTimes = {
    id: 'availability-1',
    kind: 'unavailable',
    dateExpression: null,
    namedTimePeriod: null,
    startTime: '14:30',
    endTime: '20:00',
    recurrenceKind: null,
    days: [],
    constraintLevel: 'hard',
    resolutionStatus: 'unresolved',
  };
  const availabilityWithDate = {
    ...availabilityWithTimes,
    id: 'availability-2',
    dateExpression: 'tomorrow',
    startTime: null,
    endTime: null,
  };
  const uncertainty = {
    id: 'uncertainty-1',
    targetFactId: 'task-1',
    field: 'workload',
    reason: 'amount role is ambiguous',
  };

  const inputs = [
    matrixInput({
      name: 'semantic-uncertainty',
      questionCode: 'semantic_uncertainty',
      currentUserMessage: 'それってどういう意味？',
      recentAssistant: 'レポートの量について確認したいです。',
      planningInformation: { tasks: [task], uncertainties: [uncertainty] },
      questionTarget: { collection: 'uncertainties', fact: uncertainty },
      requiredLabels: ['レポート'],
      fallbackText: '意味を一つに決められない部分を、もう少し具体的に教えてください。',
    }),
    matrixInput({
      name: 'quantity-role',
      questionCode: 'quantity_role_unresolved',
      currentUserMessage: '20ページです',
      recentAssistant: 'レポートはどのくらいありますか？',
      planningInformation: { tasks: [task], workloads: [workload] },
      questionTarget: { collection: 'workloads', fact: workload },
      requiredLabels: ['レポート'],
      fallbackText: 'レポートの20ページは、今回進めたい量ですか、それとも残っている全体量ですか？',
    }),
    matrixInput({
      name: 'availability-date-scope',
      questionCode: 'missing_availability_date_scope',
      currentUserMessage: '14時半から20時は空いていません',
      recentAssistant: 'ほかに固定予定はありますか？',
      planningInformation: { availabilityDeclarations: [availabilityWithTimes] },
      questionTarget: { collection: 'availabilityDeclarations', fact: availabilityWithTimes },
      fallbackText: 'その予定を入れられない時間は、どの日に適用しますか？',
    }),
    matrixInput({
      name: 'availability-time-bounds',
      questionCode: 'missing_time_bounds',
      currentUserMessage: '明日はバイトがあります',
      recentAssistant: '明日の予定で固定の予定はありますか？',
      planningInformation: { availabilityDeclarations: [availabilityWithDate] },
      questionTarget: { collection: 'availabilityDeclarations', fact: availabilityWithDate },
      fallbackText: 'その時間条件の開始時刻と終了時刻を教えてください。',
    }),
    matrixInput({
      name: 'planning-window',
      questionCode: 'ambiguous_planning_window',
      currentUserMessage: '来週かな、でも週末だけでもいいかも',
      recentAssistant: 'いつの予定を立てますか？',
      planningInformation: {
        planningWindows: [
          { id: 'window-1', kind: 'relative_week', value: 'next_week' },
          { id: 'window-2', kind: 'named_period', value: 'weekend' },
        ],
      },
      fallbackText: '計画期間が複数あります。今回使う期間を一つ教えてください。',
    }),
    matrixInput({
      name: 'relation',
      questionCode: 'orphan_relation_task',
      currentUserMessage: 'レポートの後に発表練習をしたい',
      recentAssistant: 'ほかに順番の希望はありますか？',
      planningInformation: { tasks: [task] },
      requiredLabels: ['レポート'],
      fallbackText: 'タスクの順序関係を確認できませんでした。どの予定を先にするか教えてください。',
    }),
  ];

  const observations: RendererMatrixObservation[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const result = await renderer.render(input);
    observations.push({
      name: input.actionId.split(':')[1] ?? `matrix-${index + 1}`,
      questionCode: input.questionCode ?? 'none',
      result,
      input,
    });
  }
  return observations;
}

function markdownForConversations(conversations: ConversationObservation[]): string {
  return conversations.flatMap((conversation) => [
    `# ${conversation.name}`,
    '',
    ...(conversation.error ? [`ERROR: ${conversation.error}`, ''] : []),
    ...conversation.turns.flatMap((turn) => [
      `## Turn ${turn.index}`,
      '',
      `ユーザー: ${turn.userText}`,
      '',
      `アプリ: ${turn.assistantText}`,
      '',
      `machine question: ${JSON.stringify(turn.questionContext)}`,
      '',
      `response source: ${turn.responseSource ?? 'unknown'}`,
      '',
    ]),
  ]).join('\n');
}

function markdownForMatrix(matrix: RendererMatrixObservation[]): string {
  return matrix.flatMap((entry) => {
    const result = entry.result as { status?: string; text?: string; reason?: string };
    return [
      `## ${entry.name} / ${entry.questionCode}`,
      '',
      `status: ${result.status ?? 'unknown'}`,
      '',
      `text: ${result.text ?? ''}`,
      '',
      `reason: ${result.reason ?? ''}`,
      '',
    ];
  }).join('\n');
}

const run = shouldRun ? describe : describe.skip;

run('Issue #156 PR #130 prompt simplification adversarial real API audit', () => {
  it('runs full application conversations and a renderer question-code matrix', async () => {
    const conversations: ConversationObservation[] = [];

    conversations.push(await runConversation({
      name: 'A fixed event interrupts a pending workload question',
      ownerId: 'issue156-user-a',
      conversationId: 'issue156-conversation-a',
      turns: [
        '明日の予定を立てたいです',
        '夏合宿の発表スライドを完成させたいです',
        'その前に、14時半から20時まではバイトです',
        'スライドは全部で20枚で、今10枚まで終わっています',
      ],
    }));

    conversations.push(await runConversation({
      name: 'B deadline interrupts the previous thread',
      ownerId: 'issue156-user-b',
      conversationId: 'issue156-conversation-b',
      turns: [
        '明日の予定を立てたいです',
        '研究室のレポートを仕上げたいです',
        '締切は明日の13時です',
        '全体で12ページで、今6ページまで書けています',
      ],
    }));

    conversations.push(await runConversation({
      name: 'C correction while effort information is still pending',
      ownerId: 'issue156-user-c',
      conversationId: 'issue156-conversation-c',
      turns: [
        '明日の予定を立てたいです',
        '夏合宿のスライドは全部20枚で、今10枚までできています。明日残りを終わらせたいです',
        '訂正です、今は12枚までできています',
        '1枚あたりだいたい8分くらいです',
      ],
    }));

    conversations.push(await runConversation({
      name: 'D clarification request must explain rather than loop',
      ownerId: 'issue156-user-d',
      conversationId: 'issue156-conversation-d',
      turns: [
        '明日の予定を立てたいです',
        'ゼミ発表の資料を完成させたいです',
        '何を教えればいいってこと？',
        '全部で15枚あって、今7枚までできています',
      ],
    }));

    const matrix = await runRendererMatrix();

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      `${outputDir}/conversations.md`,
      `# Issue #156 Full Application Conversations\n\n${markdownForConversations(conversations)}\n`,
    );
    writeFileSync(
      `${outputDir}/renderer-matrix.md`,
      `# Issue #156 Renderer Question-Code Matrix\n\n${markdownForMatrix(matrix)}\n`,
    );
    writeFileSync(
      `${outputDir}/result.json`,
      `${JSON.stringify({ conversations, matrix }, null, 2)}\n`,
    );

    for (const conversation of conversations) {
      expect(conversation.error, conversation.name).toBeNull();
    }

    const fixedEventTurn = conversations[0].turns[2];
    expect(targetSlot(fixedEventTurn)).toBe('stable_v5:missing_schedulable_work');
    expect(
      containsClockAcknowledgement(fixedEventTurn.assistantText),
      `fixed-event contribution was not observably grounded: ${fixedEventTurn.assistantText}`,
    ).toBe(true);

    const deadlineTurn = conversations[1].turns[2];
    expect(
      containsDeadlineAcknowledgement(deadlineTurn.assistantText),
      `deadline contribution was not observably grounded: ${deadlineTurn.assistantText}`,
    ).toBe(true);

    const correctionTurn = conversations[2].turns[2];
    expect(
      containsCorrectionAcknowledgement(correctionTurn.assistantText),
      `correction was not observably grounded: ${correctionTurn.assistantText}`,
    ).toBe(true);

    const clarificationQuestion = conversations[3].turns[1]?.assistantText ?? '';
    const clarificationAnswer = conversations[3].turns[2]?.assistantText ?? '';
    expect(clarificationAnswer.replace(/\s+/g, '')).not.toBe(
      clarificationQuestion.replace(/\s+/g, ''),
    );

    for (const entry of matrix) {
      const result = entry.result as { status?: string };
      expect(result.status, `${entry.name}/${entry.questionCode}`).toBe('rendered');
    }
  }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000);
});
