import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { normalizeWeeklyPlanningExistingTaskShellV5 } from './weeklyPlanningExistingTaskShellNormalizationV5';

const userText = '締切は明日の13時です';

function publicStateSummary() {
  return {
    graphRevision: 2,
    pendingQuestion: {
      actionId: null,
      questionCode: 'missing_schedulable_work',
      targetFactId: 'task-existing',
      graphRevision: 2,
      effortMeasurement: null,
      estimateForWorkloadFactId: null,
      questionBasis: null,
    },
    tasks: [{
      publicId: 'task-existing',
      category: 'study',
      title: '研究室のレポートを仕上げる',
    }],
    components: [],
    workloads: [],
  };
}

function existingNoOp(): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task_report',
      existingPublicId: 'task-existing',
      decompositionStatus: 'atomic',
      category: 'study',
      title: '研究室のレポートを仕上げる',
      study: {
        purpose: 'unknown',
        activityKind: 'writing',
        contextLabel: null,
        components: [],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: userText,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

function focusedFallback(): string {
  return JSON.stringify({
    decision: 'fallback',
    kind: null,
    constraintLevel: null,
    dateExpression: null,
    namedTimePeriod: null,
    startTime: null,
    endTime: null,
    precision: null,
  });
}

function minimalDeadlineDelta(): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task_report',
      existingPublicId: 'task-existing',
      decompositionStatus: 'atomic',
      category: 'study',
      title: '研究室のレポートを仕上げる',
      study: null,
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [{
        localId: 'constraint_report_deadline',
        targetLocalId: 'task_report',
        kind: 'deadline',
        constraintLevel: 'hard',
        dateExpression: 'tomorrow',
        namedTimePeriod: null,
        startTime: '13:00',
        endTime: null,
        precision: 'exact',
        sourceText: userText,
      }],
      recurrence: [],
      durableContextSignals: [],
      sourceText: userText,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

describe('Stable V5 existing task shell normalization', () => {
  it('fills only a public-state-verified existing study shell', () => {
    const result = normalizeWeeklyPlanningExistingTaskShellV5({
      rawResponse: minimalDeadlineDelta(),
      publicStateSummary: publicStateSummary(),
    });
    const parsed = JSON.parse(result.rawResponse) as {
      tasks: Array<{ study: unknown }>;
    };

    expect(parsed.tasks[0].study).toEqual({
      purpose: 'unknown',
      activityKind: 'unknown',
      contextLabel: null,
      components: [],
    });
    expect(result.repairs).toEqual([
      'existing-study-task-shell-filled:task_report:task-existing',
    ]);
  });

  it('does not fill an unverified or new study task', () => {
    expect(normalizeWeeklyPlanningExistingTaskShellV5({
      rawResponse: minimalDeadlineDelta(),
      publicStateSummary: { ...publicStateSummary(), tasks: [] },
    }).repairs).toEqual([]);

    const parsed = JSON.parse(minimalDeadlineDelta()) as Record<string, unknown> & {
      tasks: Array<Record<string, unknown>>;
    };
    parsed.tasks[0].existingPublicId = null;
    expect(normalizeWeeklyPlanningExistingTaskShellV5({
      rawResponse: JSON.stringify(parsed),
      publicStateSummary: publicStateSummary(),
    }).repairs).toEqual([]);
  });

  it('accepts the exact gate-21 deadline retry shape after focused temporal fallback', async () => {
    const calls: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
    const responses = [existingNoOp(), focusedFallback(), minimalDeadlineDelta()];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(input) {
        calls.push(input);
        const response = responses.shift();
        if (!response) throw new Error('response sequence exhausted');
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText,
      publicStateSummary: publicStateSummary(),
    });

    expect(calls).toHaveLength(3);
    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 3,
      repairAttempted: false,
    });
    expect(result.diagnostics.algorithmicRepairs).toContain(
      'existing-study-task-shell-filled:task_report:task-existing',
    );
    expect(result.document?.tasks[0].temporalConstraints).toEqual([
      expect.objectContaining({
        kind: 'deadline',
        dateExpression: 'tomorrow',
        startTime: '13:00',
        precision: 'exact',
      }),
    ]);
  });
});
