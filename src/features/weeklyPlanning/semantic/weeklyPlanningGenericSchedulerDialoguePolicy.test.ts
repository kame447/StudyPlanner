import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV2,
  type WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import type {
  GenericSchedulerInput,
  GenericSchedulerInputCompilationResult,
  GenericSchedulerInputIssue,
} from './weeklyPlanningGenericSchedulerInput';
import {
  deriveGenericSchedulerDialoguePolicy,
  evaluateGenericSchedulerPreviewGate,
} from './weeklyPlanningGenericSchedulerDialoguePolicy';

function source(semanticLocalId: string, sourceText: string) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId,
    sourceText,
    origin: 'user' as const,
  };
}

function graph(): WeeklyPlanningFactGraphV2 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV2(),
    revision: 2,
    tasks: [
      {
        id: 'task-study',
        category: 'study',
        title: '英単語',
        source: source('task-study', '英単語'),
        createdRevision: 1,
      },
    ],
    workloads: [
      {
        id: 'workload-study',
        taskId: 'task-study',
        componentId: null,
        quantityRole: 'target',
        amount: 80,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: source('workload-study', '80語'),
        createdRevision: 1,
      },
    ],
  };
}

function readyInput(): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 2,
    ownerId: 'user-1',
    horizon: {
      startDate: '2026-07-22',
      endDate: '2026-07-22',
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: [],
    fixedTaskReservations: [
      {
        id: 'reservation-1',
        taskId: 'task-study',
        temporalConstraintFactId: 'constraint-1',
        start: { date: '2026-07-22', time: '20:00' },
        end: { date: '2026-07-22', time: '21:00' },
        timeZone: 'Asia/Tokyo',
        constraintLevel: 'hard',
        sourceKind: 'user_commitment',
        sourceRef: 'constraint-1',
        graphRevision: 2,
      },
    ],
    taskDateEligibilities: [],
    availabilityWindows: [],
    sourceSelections: [],
    relations: [],
    sourceFactRefs: ['constraint-1', 'task-study'],
  };
}

function compilation(params: {
  status?: GenericSchedulerInputCompilationResult['status'];
  input?: GenericSchedulerInput | null;
  issues?: GenericSchedulerInputIssue[];
} = {}): GenericSchedulerInputCompilationResult {
  return {
    status: params.status ?? 'ready',
    input: params.input === undefined ? readyInput() : params.input,
    issues: params.issues ?? [],
  };
}

describe('generic scheduler dialogue policy', () => {
  it('asks for a task before evaluating scheduler issues', () => {
    const empty = createEmptyWeeklyPlanningFactGraphV2();
    const policy = deriveGenericSchedulerDialoguePolicy({
      graph: empty,
      compilation: compilation({ status: 'empty', input: null }),
    });

    expect(policy).toMatchObject({
      readinessStage: 'needs_task',
      nextQuestion: {
        issueCode: 'missing_task',
        targetFactId: null,
      },
    });
  });

  it('selects a security issue before a workload estimate issue without restarting the plan', () => {
    const policy = deriveGenericSchedulerDialoguePolicy({
      graph: graph(),
      compilation: compilation({
        status: 'needs_resolution',
        input: null,
        issues: [
          {
            domain: 'work_item',
            code: 'missing_effort_estimate',
            blocking: true,
            factId: 'workload-study',
          },
          {
            domain: 'availability',
            code: 'constraint_event_owner_mismatch',
            blocking: true,
            factId: 'source-request-1',
            details: { eventId: 'event-other-user' },
          },
        ],
      }),
    });

    expect(policy.readinessStage).toBe('needs_resolution');
    expect(policy.nextQuestion).toEqual({
      issueCode: 'availability:constraint_event_owner_mismatch',
      targetFactId: 'source-request-1',
      text: '予定データを安全に確認できなかったため、その予定は反映していません。設定を確認してください。入力済みの計画内容は保持しています。',
    });
  });

  it('asks for concrete clock bounds when a named period has no policy', () => {
    const policy = deriveGenericSchedulerDialoguePolicy({
      graph: graph(),
      compilation: compilation({
        status: 'needs_resolution',
        input: null,
        issues: [
          {
            domain: 'availability',
            code: 'named_time_period_unresolved',
            blocking: true,
            factId: 'availability-before-sleep',
            details: { namedTimePeriod: 'before_sleep' },
          },
        ],
      }),
    });

    expect(policy.nextQuestion).toEqual({
      issueCode: 'availability:named_time_period_unresolved',
      targetFactId: 'availability-before-sleep',
      text: '寝る前は、何時から何時までですか？',
    });
  });

  it('reports the final failure only after automatic retries are exhausted', () => {
    const policy = deriveGenericSchedulerDialoguePolicy({
      graph: graph(),
      compilation: compilation({
        status: 'needs_resolution',
        input: null,
        issues: [
          {
            domain: 'availability',
            code: 'constraint_source_unavailable',
            blocking: true,
            factId: 'source-request-timetable',
            details: {
              kind: 'timetable',
              failureKind: 'network_error',
              attemptCount: 3,
            },
          },
        ],
      }),
    });

    expect(policy.nextQuestion?.text).toBe(
      '時間割を自動で3回取得しましたが、確認できなかったため、まだ予定には反映していません。時間割を使わずに進めるか、設定を確認してください。入力済みの計画内容は保持しています。',
    );
  });

  it('gives a specific action for authentication failures', () => {
    const policy = deriveGenericSchedulerDialoguePolicy({
      graph: graph(),
      compilation: compilation({
        status: 'needs_resolution',
        input: null,
        issues: [
          {
            domain: 'availability',
            code: 'constraint_source_unavailable',
            blocking: true,
            factId: 'source-request-calendar',
            details: {
              kind: 'calendar',
              failureKind: 'authentication_error',
              attemptCount: 1,
            },
          },
        ],
      }),
    });

    expect(policy.nextQuestion?.text).toBe(
      'カレンダーの認証を確認できませんでした。接続設定を確認してください。入力済みの計画内容は保持しています。',
    );
  });

  it('asks the workload question when work is the highest blocking issue', () => {
    const policy = deriveGenericSchedulerDialoguePolicy({
      graph: graph(),
      compilation: compilation({
        status: 'needs_resolution',
        input: null,
        issues: [
          {
            domain: 'work_item',
            code: 'missing_effort_estimate',
            blocking: true,
            factId: 'workload-study',
          },
        ],
      }),
    });

    expect(policy.nextQuestion).toEqual({
      issueCode: 'work_item:missing_effort_estimate',
      targetFactId: 'workload-study',
      text: '英単語をこの量だけ進めるのに、どれくらい時間がかかりますか？',
    });
  });

  it('offers preview only when a complete scheduler input exists', () => {
    expect(deriveGenericSchedulerDialoguePolicy({
      graph: graph(),
      compilation: compilation(),
    })).toMatchObject({
      readinessStage: 'preview_ready',
      nextQuestion: null,
      schedulerStatus: 'ready',
    });

    expect(deriveGenericSchedulerDialoguePolicy({
      graph: graph(),
      compilation: compilation({ status: 'empty', input: null }),
    })).toMatchObject({
      readinessStage: 'needs_workload',
      nextQuestion: {
        issueCode: 'missing_schedulable_work',
      },
    });
  });

  it('binds preview authorization to conversation and graph revision', () => {
    const currentGraph = graph();
    const currentCompilation = compilation();

    expect(evaluateGenericSchedulerPreviewGate({
      conversationId: 'conversation-1',
      graph: currentGraph,
      compilation: currentCompilation,
      authorization: {
        status: 'user_authorized',
        conversationId: 'conversation-1',
        graphRevision: 2,
      },
    })).toEqual({ allowed: true, reasons: [] });

    expect(evaluateGenericSchedulerPreviewGate({
      conversationId: 'conversation-1',
      graph: currentGraph,
      compilation: currentCompilation,
      authorization: {
        status: 'assistant_suggested',
        conversationId: 'conversation-2',
        graphRevision: 1,
      },
    })).toEqual({
      allowed: false,
      reasons: [
        'authorization_missing',
        'authorization_conversation_mismatch',
        'authorization_revision_mismatch',
      ],
    });
  });

  it('rejects preview when scheduler input is unresolved', () => {
    expect(evaluateGenericSchedulerPreviewGate({
      conversationId: 'conversation-1',
      graph: graph(),
      compilation: compilation({
        status: 'needs_resolution',
        input: null,
        issues: [
          {
            domain: 'work_item',
            code: 'missing_effort_estimate',
            blocking: true,
            factId: 'workload-study',
          },
        ],
      }),
      authorization: {
        status: 'user_authorized',
        conversationId: 'conversation-1',
        graphRevision: 2,
      },
    })).toEqual({
      allowed: false,
      reasons: ['scheduler_not_ready', 'scheduler_input_missing'],
    });
  });
});
