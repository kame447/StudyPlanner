import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

describe('Stable V5 copied context normalization integration', () => {
  it('accepts a cross-turn delta without AI repair after removing an ungrounded stored concern copy', async () => {
    const response = JSON.stringify({
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      planningIntent: 'update_plan',
      planningWindow: null,
      tasks: [{
        localId: 'task-homework',
        existingPublicId: 'task-homework-public',
        category: 'study',
        title: '夏休みの課題',
        study: {
          purpose: 'homework',
          contextLabel: '夏休み',
          components: [],
        },
        workloads: [{
          localId: 'homework-half',
          quantityRole: 'target',
          amount: 0.5,
          unitCode: 'custom',
          unitLabel: '全体',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: 'next_week',
          sourceText: '来週で半分くらいまで進めたいです',
        }],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        durableContextSignals: [],
        sourceText: '夏休みの課題もまだ終わってなくて',
      }, {
        localId: 'task-mock',
        existingPublicId: 'task-mock-public',
        category: 'study',
        title: '共通テスト模試の勉強',
        study: {
          purpose: 'exam',
          contextLabel: '共通テスト模試',
          components: [{
            localId: 'component-math',
            existingPublicId: 'component-math-public',
            parentLocalId: null,
            role: 'subject',
            label: '数学',
            workloads: [],
            durableContextSignals: [{
              localId: 'copied-math-concern',
              kind: 'concern',
              value: '結構まずい',
              sourceText: '数学が結構まずい',
            }],
            sourceText: '特に数学が結構まずいです',
          }],
        },
        workloads: [{
          localId: 'mock-daily-hours',
          quantityRole: 'target',
          amount: 2,
          unitCode: 'hour',
          unitLabel: '時間',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: true,
          periodExpression: 'daily',
          sourceText: '毎日2時間くらい',
        }],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [{
          localId: 'mock-daily',
          targetLocalId: 'task-mock',
          kind: 'daily',
          count: null,
          days: [],
          sourceText: '毎日2時間くらい',
        }],
        durableContextSignals: [],
        sourceText: '2週間後に共通テスト模試もあるので、その勉強も進めたいです',
      }],
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      userContextFacts: [],
      uncertainties: [],
      corrections: [],
      decisions: [],
    });
    let calls = 0;
    const client: OpenAiCompatibleClient = {
      async createChatCompletion() {
        calls += 1;
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '夏休みの課題は、できれば来週で半分くらいまで進めたいです。模試の方は数学を中心に、毎日2時間くらい取れたらと思ってます。',
      publicStateSummary: {
        tasks: [
          { publicId: 'task-homework-public', category: 'study', title: '夏休みの課題' },
          { publicId: 'task-mock-public', category: 'study', title: '共通テスト模試の勉強' },
        ],
        components: [{
          publicId: 'component-math-public',
          taskPublicId: 'task-mock-public',
          role: 'subject',
          label: '数学',
        }],
        userPlanningContext: [{
          id: 'stored-math-concern',
          kind: 'concern',
          label: '数学',
          value: '結構まずい',
          dateExpression: null,
        }],
      },
    });

    expect(result.status).toBe('accepted');
    expect(calls).toBe(1);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
    });
    expect(result.diagnostics.algorithmicRepairs).toContain(
      'copied-component-concern-removed:1:0:0:数学',
    );
    expect(result.document?.tasks[1]?.study?.components[0]?.durableContextSignals).toEqual([]);
    expect(result.document?.tasks[1]?.recurrence).toEqual([
      expect.objectContaining({ kind: 'daily', targetLocalId: 'task-mock' }),
    ]);
  });
});
