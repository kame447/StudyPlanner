import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticTaskV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

function task(title: string, amount: number): SemanticTaskV5 {
  return {
    localId: `task-${title}`,
    category: 'study',
    title,
    study: {
      purpose: 'self_study',
      contextLabel: null,
      components: [],
    },
    workloads: [{
      localId: `workload-${title}`,
      quantityRole: 'target',
      amount,
      unitCode: title === 'レポート' ? 'page' : 'problem',
      unitLabel: title === 'レポート' ? 'ページ' : '問',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: `${title}${amount}`,
    }],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: `${title}${amount}`,
  };
}

function document(tasks: SemanticTaskV5[]): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-next-week',
      kind: 'relative_week',
      value: 'next_week',
      start: null,
      end: null,
      sourceText: '来週',
    },
    tasks,
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 semantic normalizer evidence ownership', () => {
  it('does not reparse the user utterance to manufacture missing-work errors', async () => {
    const response = document([task('レポート', 4)]);
    const calls: Array<Record<string, unknown>> = [];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(input) {
        calls.push(input as unknown as Record<string, unknown>);
        return JSON.stringify(response);
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '来週、レポートを4ページ、演習を12問進める予定を作ってください',
      traceRequestId: 'ai-owned-evidence',
    });

    expect(result.status).toBe('accepted');
    expect(result.document).toEqual(response);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
      validationErrors: [],
    });
    expect(calls).toHaveLength(1);
  });
});
