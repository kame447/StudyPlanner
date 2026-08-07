import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

function groupedDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: {
      localId: 'window-next-week',
      kind: 'relative_week',
      value: 'next_week',
      start: null,
      end: null,
      sourceText: '来週',
    },
    tasks: [{
      localId: 'task-grouped',
      category: 'study',
      title: '物理',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [
          {
            localId: 'component-physics',
            parentLocalId: null,
            role: 'subject',
            label: '物理',
            workloads: [],
            sourceText: '物理',
          },
          {
            localId: 'component-chemistry',
            parentLocalId: null,
            role: 'subject',
            label: '化学',
            workloads: [],
            sourceText: '化学',
          },
        ],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '物理と化学',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 semantic normalizer task ownership', () => {
  it('accepts the AI-selected task structure without renaming or splitting it', async () => {
    const response = groupedDocument();
    const calls: Array<Record<string, unknown>> = [];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(input) {
        calls.push(input as unknown as Record<string, unknown>);
        return JSON.stringify(response);
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '来週、物理を2時間、化学を3時間進めたいです',
      traceRequestId: 'ai-task-boundary',
    });

    expect(result.status).toBe('accepted');
    expect(result.document).toEqual(response);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
      validationErrors: [],
    });
    expect(result.diagnostics.algorithmicRepairs ?? []).not.toContain(
      'task-container-split-by-independent-roots:task-grouped',
    );
    expect(calls).toHaveLength(1);
  });
});
