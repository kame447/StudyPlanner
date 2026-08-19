import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';

function publicStateSummary(questionCode: 'missing_effort_estimate' | 'quantity_role_unresolved') {
  return {
    graphRevision: 2,
    previousCompatibilityStatus: 'revision_pending',
    pendingQuestion: {
      actionId: null,
      questionCode,
      targetFactId: 'workload-vocab',
      graphRevision: 2,
    },
    workloads: [{
      publicId: 'workload-vocab',
      taskPublicId: 'task-vocab',
      componentPublicId: 'component-vocab',
      quantityRole: questionCode === 'quantity_role_unresolved' ? 'declared' : 'target',
      amount: 220,
      unitCode: 'word',
      unitLabel: '語',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
    }],
    tasks: [{ publicId: 'task-vocab', category: 'study', title: '英単語を進める' }],
    components: [{
      publicId: 'component-vocab',
      taskPublicId: 'task-vocab',
      parentComponentPublicId: null,
      role: 'material',
      label: '英単語帳',
    }],
  };
}

function progressPublicStateSummary() {
  return {
    graphRevision: 4,
    previousCompatibilityStatus: 'revision_pending',
    pendingQuestion: {
      actionId: null,
      questionCode: 'missing_effort_estimate',
      targetFactId: 'workload-completed',
      graphRevision: 4,
    },
    workloads: [
      {
        publicId: 'workload-completed',
        taskPublicId: 'task-report',
        componentPublicId: null,
        quantityRole: 'completed',
        amount: 70,
        unitCode: 'custom',
        unitLabel: '%',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
      },
      {
        publicId: 'workload-remaining',
        taskPublicId: 'task-report',
        componentPublicId: null,
        quantityRole: 'remaining',
        amount: 30,
        unitCode: 'custom',
        unitLabel: '%',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
      },
    ],
    tasks: [{ publicId: 'task-report', category: 'study', title: 'ゼミ発表の資料を完成させる' }],
    components: [],
  };
}

function focusedWorkloads(result: Awaited<ReturnType<ReturnType<typeof createWeeklyPlanningSemanticNormalizerV5>['normalize']>>) {
  const task = result.document?.tasks[0];
  return [
    ...(task?.workloads ?? []),
    ...(task?.study?.components ?? []).flatMap((component) => component.workloads),
  ];
}

describe('Stable V5 focused contextual-answer semantic route', () => {
  it('interprets a direct pending effort reply without invoking the generic full-plan normalizer', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => JSON.stringify({
        decision: 'effort_answer',
        minutes: 30,
        precision: 'approximate',
        quantityRole: null,
      })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '30分くらいです。',
      publicStateSummary: publicStateSummary('missing_effort_estimate'),
      traceRequestId: 'turn-3',
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
      validationErrors: [],
    });
    expect(result.document).toMatchObject({
      planningIntent: 'update_plan',
      planningWindow: null,
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      uncertainties: [],
      corrections: [],
      decisions: [],
    });
    expect(result.document?.tasks).toHaveLength(1);
    expect(result.document?.tasks[0]).toMatchObject({
      existingPublicId: 'task-vocab',
      category: 'study',
      title: '英単語を進める',
      study: {
        components: [expect.objectContaining({
          existingPublicId: 'component-vocab',
          role: 'material',
          label: '英単語帳',
        })],
      },
    });
    expect(focusedWorkloads(result)).toEqual([
      expect.objectContaining({
        localId: 'workload-vocab',
        quantityRole: 'target',
        amount: 220,
        unitCode: 'word',
      }),
    ]);
    expect(result.document?.tasks[0].effortEstimates).toEqual([
      expect.objectContaining({
        targetLocalId: 'workload-vocab',
        kind: 'total_duration',
        minutes: 30,
        unitCode: null,
        precision: 'approximate',
        sourceText: '30分くらいです。',
      }),
    ]);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);

    const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    expect(request.responseFormat).toMatchObject({
      json_schema: { name: 'weekly_planning_focused_contextual_answer_v5' },
    });
    expect(JSON.stringify(request.messages)).not.toContain('英単語220語');
  });

  it('binds an explicit remaining-duration side contribution to the unique remaining workload', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => JSON.stringify({
        decision: 'remaining_effort_answer',
        minutes: 45,
        precision: 'approximate',
        quantityRole: null,
      })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '残りは45分くらいです。',
      publicStateSummary: progressPublicStateSummary(),
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks[0].existingPublicId).toBe('task-report');
    expect(focusedWorkloads(result)).toEqual([
      expect.objectContaining({
        localId: 'workload-remaining',
        quantityRole: 'remaining',
        amount: 30,
        unitCode: 'custom',
        unitLabel: '%',
      }),
    ]);
    expect(result.document?.tasks[0].effortEstimates).toEqual([
      expect.objectContaining({
        targetLocalId: 'workload-remaining',
        kind: 'total_duration',
        minutes: 45,
        unitCode: null,
        precision: 'approximate',
      }),
    ]);
    expect(focusedWorkloads(result)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ unitCode: 'minute', amount: 45 }),
    ]));
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
    const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    expect(JSON.stringify(request.messages)).toContain('workload-remaining');
    expect(JSON.stringify(request.messages)).toContain('remainingWorkload');
  });

  it('preserves a per-unit effort answer and keeps it bound to the pending workload', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => JSON.stringify({
        decision: 'effort_per_unit_answer',
        minutes: 8,
        precision: 'approximate',
        quantityRole: null,
      })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '1語あたりだいたい8分くらいです。',
      publicStateSummary: publicStateSummary('missing_effort_estimate'),
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks[0].existingPublicId).toBe('task-vocab');
    expect(focusedWorkloads(result)).toEqual([
      expect.objectContaining({ localId: 'workload-vocab', amount: 220, unitCode: 'word' }),
    ]);
    expect(result.document?.tasks[0].effortEstimates).toEqual([
      expect.objectContaining({
        targetLocalId: 'workload-vocab',
        kind: 'duration_per_unit',
        minutes: 8,
        unitCode: 'word',
        sourceText: '1語あたりだいたい8分くらいです。',
      }),
    ]);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('interprets a direct quantity-role reply through the same exact-pending-target route', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => JSON.stringify({
        decision: 'quantity_role_answer',
        minutes: null,
        precision: null,
        quantityRole: 'remaining',
      })),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '残っている量です。',
      publicStateSummary: publicStateSummary('quantity_role_unresolved'),
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks[0].existingPublicId).toBe('task-vocab');
    expect(focusedWorkloads(result)).toEqual([
      expect.objectContaining({
        localId: 'workload-vocab',
        quantityRole: 'remaining',
        amount: 220,
        unitCode: 'word',
        sourceText: '残っている量です。',
      }),
    ]);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('falls back to generic semantics and rechecks a schema-valid no-op when the focused AI reports other planning facts', async () => {
    const genericDocument = JSON.stringify({
      schemaVersion: 'weekly-planning-semantic-v5',
      planningIntent: 'discuss',
      planningWindow: null,
      tasks: [],
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      userContextFacts: [],
      uncertainties: [],
      corrections: [],
      decisions: [],
    });
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn()
        .mockResolvedValueOnce(JSON.stringify({
          decision: 'fallback',
          minutes: null,
          precision: null,
          quantityRole: null,
        }))
        .mockResolvedValueOnce(genericDocument)
        .mockResolvedValueOnce(genericDocument)
        .mockResolvedValueOnce(genericDocument),
    };

    const currentUserText = '30分くらい。あと火曜じゃなくて水曜を空けて。';
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: currentUserText,
      publicStateSummary: publicStateSummary('missing_effort_estimate'),
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.tasks).toEqual([]);
    expect(client.createChatCompletion).toHaveBeenCalledTimes(4);
    const secondRequest = vi.mocked(client.createChatCompletion).mock.calls[1][0];
    const thirdRequest = vi.mocked(client.createChatCompletion).mock.calls[2][0];
    const fourthRequest = vi.mocked(client.createChatCompletion).mock.calls[3][0];
    expect(secondRequest.responseFormat).toMatchObject({
      json_schema: { name: 'weekly_planning_semantic_document_v5' },
    });
    expect(thirdRequest.responseFormat).toMatchObject({
      json_schema: { name: 'weekly_planning_semantic_document_v5' },
    });
    expect(fourthRequest.responseFormat).toMatchObject({
      json_schema: { name: 'weekly_planning_semantic_document_v5' },
    });
    const thirdInstruction = thirdRequest.messages[thirdRequest.messages.length - 1]?.content ?? '';
    const fourthInstruction = fourthRequest.messages[fourthRequest.messages.length - 1]?.content ?? '';
    expect(thirdInstruction).toContain('Re-read that exact current userText');
    expect(thirdInstruction).toContain(currentUserText);
    expect(fourthInstruction).toContain('final independent completeness pass');
    expect(fourthInstruction).toContain(currentUserText);
  });
});